import { Schema } from "effect";

export const NonNegative = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export class Resources extends Schema.Class<Resources>("Resources")({
  /**
   * Number of CPUs allocated to the sandbox.
   *
   * Can be a fractional number, e.g. 0.5 for half a CPU.
   *
   * Note: Fractional CPU allocation behaves varies across different sandbox providers.
   */
  numCPUs: Schema.OptionFromOptionalNullOr(NonNegative),

  /** Number of GPUs allocated to the sandbox. */
  numGPUs: Schema.OptionFromOptionalNullOr(NonNegativeInt),

  /** Memory allocated to the sandbox in MiB. */
  memoryMiB: Schema.OptionFromOptionalNullOr(NonNegativeInt),

  /** Storage allocated to the sandbox in MiB. */
  storageMiB: Schema.OptionFromOptionalNullOr(NonNegativeInt),

  /** Maximum time allowed to build a snapshot, in seconds. */
  buildTimeoutSec: Schema.OptionFromOptionalNullOr(NonNegativeInt),

  /** Maximum time allowed for the sandbox to run, in seconds. */
  runTimeoutSec: Schema.OptionFromOptionalNullOr(NonNegativeInt),
}) {}
