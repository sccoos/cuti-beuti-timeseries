from __future__ import annotations

import io
import json
import subprocess
import zipfile
from datetime import datetime, timezone

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq


CURRENT_YEAR = datetime.now(tz=timezone.utc).year
ANCHOR_YEAR = 2021
ROLLING_WINDOW_DAYS = 7

DATASETS = {
    "cuti": {
        "name": "CUTI",
        "url": "https://mjacox.com/wp-content/uploads/CUTI_daily.csv",
        "units": "m^2 s^-1",
        "color": "#3f8fc5",
        "legend_position": "bottom",
    },
    "beuti": {
        "name": "BEUTI",
        "url": "https://mjacox.com/wp-content/uploads/BEUTI_daily.csv",
        "units": "mmol m^-1 s^-1",
        "color": "#2c9b84",
        "legend_position": "right",
    },
}


def serialize_parquet(dataframe: pd.DataFrame) -> bytes:
    buffer = io.BytesIO()
    table = pa.Table.from_pandas(dataframe, preserve_index=False)
    pq.write_table(table, buffer)
    return buffer.getvalue()


def latitude_sort_key(label: str) -> int:
    return int(label.rstrip("N"))


def read_remote_csv(url: str) -> pd.DataFrame:
    response = subprocess.run(
        ["curl", "-L", "--silent", url],
        check=True,
        capture_output=True,
        text=True,
    )
    return pd.read_csv(io.StringIO(response.stdout))


def load_dataset(dataset_id: str, config: dict[str, str]) -> pd.DataFrame:
    wide = read_remote_csv(config["url"])
    latitude_columns = [column for column in wide.columns if column.endswith("N")]

    long = wide.melt(
        id_vars=["year", "month", "day"],
        value_vars=latitude_columns,
        var_name="latitude_label",
        value_name="value",
    )

    long["dataset"] = dataset_id
    long["date"] = pd.to_datetime(long[["year", "month", "day"]], utc=False)
    long["latitude"] = long["latitude_label"].str.rstrip("N").astype(int)
    long["month_day"] = long["date"].dt.strftime("%m-%d")
    long = long[long["month_day"] != "02-29"].copy()

    long["value"] = pd.to_numeric(long["value"], errors="coerce")
    long = long.sort_values(["dataset", "latitude", "year", "date"]).reset_index(drop=True)
    long["smoothed_value"] = (
        long.groupby(["dataset", "latitude", "year"], sort=False)["value"]
        .transform(lambda series: series.rolling(window=ROLLING_WINDOW_DAYS, center=True, min_periods=1).mean())
    )
    long["anchor_date"] = pd.to_datetime(f"{ANCHOR_YEAR}-" + long["month_day"], format="%Y-%m-%d")

    return long[
        [
            "dataset",
            "latitude",
            "latitude_label",
            "date",
            "year",
            "month",
            "day",
            "month_day",
            "anchor_date",
            "value",
            "smoothed_value",
        ]
    ]


def build_outputs() -> tuple[pd.DataFrame, pd.DataFrame, dict[str, object]]:
    frames = [load_dataset(dataset_id, config) for dataset_id, config in DATASETS.items()]
    combined = pd.concat(frames, ignore_index=True)

    historical = combined[combined["year"] < CURRENT_YEAR].copy()
    current_year = combined[combined["year"] == CURRENT_YEAR].copy()

    climatology = (
        historical.groupby(["dataset", "latitude", "latitude_label", "month_day", "anchor_date"], as_index=False)
        .agg(
            mean_value=("smoothed_value", "mean"),
            std_value=("smoothed_value", "std"),
        )
        .sort_values(["dataset", "latitude", "anchor_date"])
        .reset_index(drop=True)
    )
    climatology["std_value"] = climatology["std_value"].fillna(0.0)
    climatology["lower_value"] = climatology["mean_value"] - climatology["std_value"]
    climatology["upper_value"] = climatology["mean_value"] + climatology["std_value"]

    current_year = current_year.sort_values(["dataset", "latitude", "date"]).reset_index(drop=True)

    latitudes = sorted(combined["latitude_label"].dropna().unique().tolist(), key=latitude_sort_key)
    latest_date = current_year["date"].max() if not current_year.empty else combined["date"].max()

    manifest = {
        "generated_at": datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "current_year": CURRENT_YEAR,
        "rolling_window_days": ROLLING_WINDOW_DAYS,
        "latest_available_date": latest_date.strftime("%Y-%m-%d") if pd.notna(latest_date) else None,
        "latitudes": [{"label": label, "value": latitude_sort_key(label)} for label in latitudes],
        "default_latitude": "40N" if "40N" in latitudes else (latitudes[0] if latitudes else None),
        "datasets": [
            {
                "id": dataset_id,
                "name": config["name"],
                "units": config["units"],
                "color": config["color"],
                "legend_position": config["legend_position"],
            }
            for dataset_id, config in DATASETS.items()
        ],
    }

    return climatology, current_year, manifest


def build_archive() -> bytes:
    climatology, current_year, manifest = build_outputs()

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("climatology.parquet", serialize_parquet(climatology))
        archive.writestr("current_year.parquet", serialize_parquet(current_year))
        archive.writestr("manifest.json", json.dumps(manifest, indent=2))

    return buffer.getvalue()


def main() -> None:
    import sys

    sys.stdout.buffer.write(build_archive())


if __name__ == "__main__":
    main()
