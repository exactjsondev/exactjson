import type { Hono } from "hono";
import type { AppBindings } from "../../types";
import { airportDelaysHandler } from "./routes/airportDelays";
import { destinationBriefHandler } from "./routes/destinationBrief";
import { hazardBriefHandler } from "./routes/hazardBrief";
import { siteWindowHandler } from "./routes/siteWindow";
import { weatherGnssHandler } from "./routes/weatherGnss";

export function registerWorldPackRoutes(app: Hono<AppBindings>): void {
  app.get("/v1/aviation/airport-delays", airportDelaysHandler);
  app.get("/v1/space/weather-gnss", weatherGnssHandler);
  app.get("/v1/geo/hazard-brief", hazardBriefHandler);
  app.get("/v1/travel/destination-brief", destinationBriefHandler);
  app.get("/v1/solar/site-window", siteWindowHandler);
}
