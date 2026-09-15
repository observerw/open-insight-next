import { DateTime, Schedule, Stream } from "effect";

export const toTimestamps = (schedule: Schedule.Schedule<unknown>): Stream.Stream<DateTime.Utc> =>
  Stream.fromSchedule(schedule).pipe(Stream.mapEffect(() => DateTime.now));

export const fromSchedule = (schedule?: Schedule.Schedule<unknown>): Stream.Stream<DateTime.Utc> =>
  schedule ? toTimestamps(schedule) : toTimestamps(Schedule.forever);
