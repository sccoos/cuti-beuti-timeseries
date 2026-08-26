import {createElement, useEffect, useRef, useState} from "npm:react";
import {createRoot} from "npm:react-dom/client";
import * as d3 from "npm:d3";

const AXIS_YEAR = 2021;
const MONTH_TICKS = d3.timeMonth.range(new Date(AXIS_YEAR, 0, 1), new Date(AXIS_YEAR + 1, 0, 1));
const ENVELOPE_COLOR = "#dfe3e8";
const MEAN_COLOR = "#1f1f1f";

function parsePlotRow(row) {
  return {
    ...row,
    latitude: Number(row.latitude),
    smoothed_value: row.smoothed_value == null ? null : Number(row.smoothed_value),
    mean_value: row.mean_value == null ? null : Number(row.mean_value),
    lower_value: row.lower_value == null ? null : Number(row.lower_value),
    upper_value: row.upper_value == null ? null : Number(row.upper_value),
    date: row.date ? new Date(row.date) : null,
    anchor_date: row.anchor_date ? new Date(row.anchor_date) : null
  };
}

function buildSeriesIndex(rows, sortKey) {
  const index = new Map();

  for (const rawRow of rows) {
    const row = parsePlotRow(rawRow);
    const seriesKey = `${row.dataset}:${row.latitude_label}`;

    if (!index.has(seriesKey)) {
      index.set(seriesKey, []);
    }

    index.get(seriesKey).push(row);
  }

  for (const seriesRows of index.values()) {
    seriesRows.sort((left, right) => d3.ascending(left[sortKey], right[sortKey]));
  }

  return index;
}

function computeYDomain(climatologyRows, currentRows) {
  const values = [];

  for (const row of climatologyRows) {
    if (Number.isFinite(row.lower_value)) values.push(row.lower_value);
    if (Number.isFinite(row.upper_value)) values.push(row.upper_value);
    if (Number.isFinite(row.mean_value)) values.push(row.mean_value);
  }

  for (const row of currentRows) {
    if (Number.isFinite(row.smoothed_value)) values.push(row.smoothed_value);
  }

  if (!values.length) {
    return [-1, 1];
  }

  const [min, max] = d3.extent(values);
  const span = max - min || Math.max(Math.abs(min), 1);
  const padding = span * 0.12;
  return [min - padding, max + padding];
}

function rowAtDate(rows, date) {
  const closest = d3.least(rows, (row) => Math.abs(+row.anchor_date - +date));
  return closest && Math.abs(+closest.anchor_date - +date) < 12 * 60 * 60 * 1000 ? closest : null;
}

function formatValue(value) {
  return Number.isFinite(value) ? d3.format(".4~g")(value) : "No data";
}

function drawPlot(container, {dataset, latitudeLabel, climatologyRows, currentRows, currentYear, rollingWindowDays, onHoverDate}) {
  const width = Math.max(container.clientWidth, 320);
  const height = Math.max(container.clientHeight, 320);
  // Reserve a footer for the legend so it never obscures the series.
  const margin = {top: 48, right: 24, bottom: 82, left: 72};
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const x = d3
    .scaleTime()
    .domain([new Date(AXIS_YEAR, 0, 1), new Date(AXIS_YEAR, 11, 31)])
    .range([0, innerWidth]);

  const y = d3.scaleLinear().domain(computeYDomain(climatologyRows, currentRows)).nice().range([innerHeight, 0]);

  const svg = d3
    .create("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("class", "upwelling-chart")
    .attr("role", "img")
    .attr("aria-label", `${dataset.name} climatology at ${latitudeLabel.replace("N", "\u00b0N")}`);

  const plot = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  plot
    .append("g")
    .attr("class", "grid grid--x")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).tickValues(MONTH_TICKS).tickSize(-innerHeight).tickFormat(""))
    .call((axis) => axis.select(".domain").remove());

  plot
    .append("g")
    .attr("class", "grid grid--y")
    .call(d3.axisLeft(y).ticks(6).tickSize(-innerWidth).tickFormat(""))
    .call((axis) => axis.select(".domain").remove());

  plot
    .append("path")
    .datum(climatologyRows)
    .attr("fill", ENVELOPE_COLOR)
    .attr("stroke", "none")
    .attr(
      "d",
      d3
        .area()
        .defined((row) => Number.isFinite(row.lower_value) && Number.isFinite(row.upper_value))
        .x((row) => x(row.anchor_date))
        .y0((row) => y(row.lower_value))
        .y1((row) => y(row.upper_value))
    );

  plot
    .append("path")
    .datum(climatologyRows)
    .attr("fill", "none")
    .attr("stroke", MEAN_COLOR)
    .attr("stroke-width", 2.5)
    .attr("stroke-dasharray", "9 7")
    .attr("stroke-linecap", "round")
    .attr(
      "d",
      d3
        .line()
        .defined((row) => Number.isFinite(row.mean_value))
        .x((row) => x(row.anchor_date))
        .y((row) => y(row.mean_value))
    );

  plot
    .append("path")
    .datum(currentRows)
    .attr("fill", "none")
    .attr("stroke", dataset.color)
    .attr("stroke-width", 3)
    .attr("stroke-linecap", "round")
    .attr("stroke-linejoin", "round")
    .attr(
      "d",
      d3
        .line()
        .defined((row) => Number.isFinite(row.smoothed_value))
        .x((row) => x(row.anchor_date))
        .y((row) => y(row.smoothed_value))
    );

  plot
    .append("g")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).tickValues(MONTH_TICKS).tickFormat(d3.timeFormat("%b")))
    .call((axis) => {
      axis.selectAll("text").attr("class", "axis-label");
      axis.selectAll("line").attr("class", "axis-tick");
      axis.select(".domain").attr("class", "axis-domain");
    });

  plot
    .append("g")
    .call(d3.axisLeft(y).ticks(6).tickFormat(d3.format("~g")))
    .call((axis) => {
      axis.selectAll("text").attr("class", "axis-label");
      axis.selectAll("line").attr("class", "axis-tick");
      axis.select(".domain").attr("class", "axis-domain");
    });

  svg
    .append("text")
    .attr("class", "chart-title")
    .attr("x", width / 2)
    .attr("y", 28)
    .attr("text-anchor", "middle")
    .text(`${dataset.name} at ${latitudeLabel.replace("N", "\u00b0N")} (${rollingWindowDays}-Day Smoothing)`);

  svg
    .append("text")
    .attr("class", "chart-y-label")
    .attr("transform", `translate(24, ${height / 2}) rotate(-90)`)
    .attr("text-anchor", "middle")
    .text(`${dataset.name} (${dataset.units})`);

  const legendItems = [
    {label: "Historical Mean", kind: "mean"},
    {label: "Historical \u00b1 1\u03c3", kind: "band"},
    {label: String(currentYear), kind: "current"}
  ];

  const legendWidth = Math.min(500, width - 24);
  const legendHeight = 34;
  const legendX = (width - legendWidth) / 2;
  const legendY = height - legendHeight - 14;
  const legend = svg.append("g").attr("transform", `translate(${legendX},${legendY})`);

  legend
    .append("rect")
    .attr("class", "legend-box")
    .attr("width", legendWidth)
    .attr("height", legendHeight);

  const swatchWidth = 32;
  // The long historical labels need wider slots than the short year label.
  const legendOffsets = [14, 184, 358];
  const row = legend
    .selectAll("g")
    .data(legendItems)
    .join("g")
    .attr("transform", (_item, index) => `translate(${legendOffsets[index]}, 18)`);

  row
    .filter((item) => item.kind === "mean")
    .append("line")
    .attr("x1", 0)
    .attr("x2", swatchWidth)
    .attr("y1", 0)
    .attr("y2", 0)
    .attr("stroke", MEAN_COLOR)
    .attr("stroke-width", 2.5)
    .attr("stroke-dasharray", "9 7");

  row
    .filter((item) => item.kind === "band")
    .append("rect")
    .attr("x", 0)
    .attr("y", -8)
    .attr("width", swatchWidth)
    .attr("height", 14)
    .attr("fill", ENVELOPE_COLOR);

  row
    .filter((item) => item.kind === "current")
    .append("line")
    .attr("x1", 0)
    .attr("x2", swatchWidth)
    .attr("y1", 0)
    .attr("y2", 0)
    .attr("stroke", dataset.color)
    .attr("stroke-width", 3);

  row
    .append("text")
    .attr("class", "legend-label")
    .attr("x", swatchWidth + 7)
    .attr("y", 5)
    .text((item) => item.label);

  const hoverLayer = plot.append("g").attr("class", "hover-layer").attr("display", "none");
  const hoverMarker = hoverLayer
    .append("line")
    .attr("class", "hover-marker")
    .attr("y1", 0)
    .attr("y2", innerHeight);
  const meanPoint = hoverLayer.append("circle").attr("class", "hover-point hover-point--mean").attr("r", 4);
  const currentPoint = hoverLayer.append("circle").attr("class", "hover-point hover-point--current").attr("r", 4).attr("fill", dataset.color);
  const tooltipWidth = 178;
  const tooltipHeight = 70;
  const tooltip = hoverLayer.append("g").attr("class", "hover-tooltip");
  const tooltipDate = tooltip.append("text").attr("class", "hover-tooltip__date").attr("x", 10).attr("y", 18);
  const tooltipMean = tooltip.append("text").attr("x", 10).attr("y", 38);
  const tooltipCurrent = tooltip.append("text").attr("x", 10).attr("y", 58);

  tooltip.append("rect").attr("width", tooltipWidth).attr("height", tooltipHeight).lower();

  function updateHover(hoveredDate) {
    if (hoveredDate == null) {
      hoverLayer.attr("display", "none");
      return;
    }

    const date = new Date(hoveredDate);
    const climatologyRow = rowAtDate(climatologyRows, date);
    const currentRow = rowAtDate(currentRows, date);
    const markerX = x(date);
    const tooltipX = Math.min(Math.max(markerX + 12, 6), innerWidth - tooltipWidth - 6);

    hoverLayer.attr("display", null);
    hoverMarker.attr("x1", markerX).attr("x2", markerX);
    meanPoint
      .attr("display", Number.isFinite(climatologyRow?.mean_value) ? null : "none")
      .attr("cx", markerX)
      .attr("cy", Number.isFinite(climatologyRow?.mean_value) ? y(climatologyRow.mean_value) : 0);
    currentPoint
      .attr("display", Number.isFinite(currentRow?.smoothed_value) ? null : "none")
      .attr("cx", markerX)
      .attr("cy", Number.isFinite(currentRow?.smoothed_value) ? y(currentRow.smoothed_value) : 0);
    tooltip.attr("transform", `translate(${tooltipX}, 10)`);
    tooltipDate.text(d3.timeFormat("%b %-d")(date));
    tooltipMean.text(`Historical mean: ${formatValue(climatologyRow?.mean_value)}`);
    tooltipCurrent.text(`${currentYear}: ${formatValue(currentRow?.smoothed_value)}`);
  }

  const interactionLayer = plot
    .append("rect")
    .attr("class", "hover-overlay")
    .attr("width", innerWidth)
    .attr("height", innerHeight)
    .on("pointermove", (event) => {
      const [pointerX] = d3.pointer(event, interactionLayer.node());
      const clampedX = Math.max(0, Math.min(innerWidth, pointerX));
      onHoverDate(d3.utcDay.round(x.invert(clampedX)).getTime());
    })
    .on("pointerleave", () => onHoverDate(null));

  container.replaceChildren(svg.node());
  return {updateHover};
}

function PlotPanel({dataset, latitudeLabel, climatologyRows, currentRows, currentYear, rollingWindowDays, hoveredDate, onHoverDate}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const hoveredDateRef = useRef(hoveredDate);
  const onHoverDateRef = useRef(onHoverDate);

  hoveredDateRef.current = hoveredDate;
  onHoverDateRef.current = onHoverDate;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const render = () => {
      chartRef.current = drawPlot(container, {
        dataset,
        latitudeLabel,
        climatologyRows,
        currentRows,
        currentYear,
        rollingWindowDays,
        onHoverDate: (date) => onHoverDateRef.current(date)
      });
      chartRef.current.updateHover(hoveredDateRef.current);
    };
    render();

    const observer = new ResizeObserver(render);
    observer.observe(container);

    return () => observer.disconnect();
  }, [dataset, latitudeLabel, climatologyRows, currentRows, currentYear, rollingWindowDays]);

  useEffect(() => {
    chartRef.current?.updateHover(hoveredDate);
  }, [hoveredDate]);

  return createElement("div", {className: "plot-card__chart", ref: containerRef});
}

function UpwellingTimeseries({climatologyRows, currentYearRows, manifest}) {
  const seriesIndexesRef = useRef(null);
  if (seriesIndexesRef.current == null) {
    seriesIndexesRef.current = {
      climatology: buildSeriesIndex(climatologyRows, "anchor_date"),
      currentYear: buildSeriesIndex(currentYearRows, "date")
    };
  }

  const {climatology: climatologyIndex, currentYear: currentYearIndex} = seriesIndexesRef.current;
  const [selectedLatitude, setSelectedLatitude] = useState(manifest.default_latitude ?? manifest.latitudes[0]?.label ?? "");
  const [hoveredDate, setHoveredDate] = useState(null);

  const updateHoveredDate = (nextDate) => {
    setHoveredDate((previousDate) => (previousDate === nextDate ? previousDate : nextDate));
  };

  return createElement(
    "div",
    {className: "upwelling-dashboard"},
    createElement(
      "label",
      {className: "dashboard-control"},
      createElement("span", {className: "dashboard-control__label"}, "Latitude:"),
      createElement(
        "select",
        {
          className: "dashboard-control__select",
          value: selectedLatitude,
          onChange: (event) => {
            setSelectedLatitude(event.target.value);
            setHoveredDate(null);
          }
        },
        manifest.latitudes.map((latitude) =>
          createElement(
            "option",
            {key: latitude.label, value: latitude.label},
            latitude.label.replace("N", "\u00b0N")
          )
        )
      )
    ),
    createElement(
      "div",
      {className: "plot-grid"},
      manifest.datasets.map((dataset) =>
        createElement(PlotPanel, {
          key: dataset.id,
          dataset,
          latitudeLabel: selectedLatitude,
          climatologyRows: climatologyIndex.get(`${dataset.id}:${selectedLatitude}`) ?? [],
          currentRows: currentYearIndex.get(`${dataset.id}:${selectedLatitude}`) ?? [],
          currentYear: manifest.current_year,
          rollingWindowDays: manifest.rolling_window_days,
          hoveredDate,
          onHoverDate: updateHoveredDate
        })
      )
    )
  );
}

export function renderUpwellingTimeseries(props) {
  const container = document.createElement("div");
  const root = createRoot(container);
  root.render(createElement(UpwellingTimeseries, props));
  return container;
}
