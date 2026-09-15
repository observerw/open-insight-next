import { Schema } from "effect";

export const EvalID = Schema.String;

export const TaskID = Schema.Struct({
  evalID: EvalID,
  taskID: Schema.String,
});
export type TaskID = Schema.Schema.Type<typeof TaskID>;

export const TrailID = Schema.Struct({
  ...TaskID.fields,
  trailIdx: Schema.Number,
});
export type TrailID = Schema.Schema.Type<typeof TrailID>;

export const SessionID = Schema.Struct({
  ...TrailID.fields,
  sessionIdx: Schema.Number,
});
export type SessionID = Schema.Schema.Type<typeof SessionID>;
