---
sql:
  climatology: ./data/cuti_beuti_timeseries/climatology.parquet
  current_year: ./data/cuti_beuti_timeseries/current_year.parquet
---

```js
import {renderUpwellingTimeseries} from "./components/UpwellingTimeseries.js";

document.title = "US West Coast Upwelling Timeseries";
const manifest = await FileAttachment("data/cuti_beuti_timeseries/manifest.json").json();
const climatologyRows = (await sql`SELECT * FROM climatology`).toArray();
const currentYearRows = (await sql`SELECT * FROM current_year`).toArray();

const upwellingTimeseries = renderUpwellingTimeseries({
  manifest,
  climatologyRows,
  currentYearRows
});

const page = document.createElement("div");
page.className = "dashboard-page";

const plotPane = document.createElement("div");
plotPane.className = "dashboard-plot-pane";
plotPane.append(upwellingTimeseries);

page.append(plotPane);
display(page);
```
