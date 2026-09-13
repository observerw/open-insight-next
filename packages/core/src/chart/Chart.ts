import { Schema } from "effect";

const NumOrString = Schema.Union([Schema.Number, Schema.String]);

class DataPointBase extends Schema.TaggedClass<DataPointBase>()("Datapoint", {
  legend: Schema.String,
}) {}

export class Area extends DataPointBase.extend<Area>("Area")({
  x: NumOrString,
  y: Schema.Number,
}) {}

export class Line extends DataPointBase.extend<Line>("Line")({
  x: NumOrString,
  y: Schema.Number,
}) {}

export class Bar extends DataPointBase.extend<Bar>("Bar")({
  x: NumOrString,
  y: Schema.Number,
}) {}

export class Scatter extends DataPointBase.extend<Scatter>("Scatter")({
  x: NumOrString,
  y: Schema.Number,
  size: Schema.optionalKey(Schema.Number),
}) {}

export class Pie extends DataPointBase.extend<Pie>("Pie")({
  value: Schema.Number,
}) {}

// RadarChart data points use a category/name plus one numeric value.
export class Radar extends DataPointBase.extend<Radar>("Radar")({
  value: Schema.Number,
}) {}

export class RadialBar extends DataPointBase.extend<RadialBar>("RadialBar")({
  value: Schema.Number,
}) {}

export class Funnel extends DataPointBase.extend<Funnel>("Funnel")({
  value: Schema.Number,
}) {}

// restricted by https://recharts.github.io/en-US/api/ComposedChart/
export const Composable = Schema.Union([Area, Line, Bar, Scatter]);
export type Composable = Schema.Schema.Type<typeof Composable>;
export const ComposablePoints = Schema.Array(Composable);
export type ComposablePoints = Schema.Schema.Type<typeof ComposablePoints>;

export const Standalone = Schema.Union([Pie, Radar, RadialBar, Funnel]);
export type Standalone = Schema.Schema.Type<typeof Standalone>;

export const DataPoint = Schema.Union([Composable, Standalone]);
export type DataPoint = Schema.Schema.Type<typeof DataPoint>;

export const DataPoints = Schema.Array(DataPoint);
export type DataPoints<Point extends DataPoint = DataPoint> = Point extends DataPoint
  ? Array<Point>
  : never;

export const Points = Schema.Union([DataPoints, ComposablePoints]);
export type Points = Schema.Schema.Type<typeof Points>;
