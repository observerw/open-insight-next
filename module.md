# Effect 模块组织形式

## 结构

```
src/
├── index.ts              # barrel 导出
├── Effect.ts             # 每个模块一个文件
├── Array.ts
├── ...
├── internal/             # 内部实现，不对外暴露
│   ├── core.ts
│   ├── effect.ts
│   └── ...
└── testing/              # 测试工具
    ├── index.ts
    └── ...
```

## 公共模块（`src/*.ts`）

一个文件 = 一个模块 = 一个命名空间。

```ts
import { Array, Option, Effect } from "effect";
// 或
import { Array } from "effect/Array";
```

依赖其他模块时用 `import * as`：

```ts
import * as Option from "./Option.ts";
import * as Predicate from "./Predicate.ts";
```

每个导出项标注 `@category` 和 `@since`。

## 内部实现（`src/internal/`）

辅助函数、运行时实现等放这里，用 `/** @internal */` 标注。package.json 中 `"./internal/*": null` 禁止外部访问。

```ts
// src/internal/array.ts
/** @internal */
export const isArrayNonEmpty = <A>(self: ReadonlyArray<A>): self is NonEmptyArray<A> =>
  self.length > 0;

// src/Array.ts
import * as internalArray from "./internal/array.ts";

export const isEmpty = <A>(self: ReadonlyArray<A>): boolean =>
  internalArray.isArrayNonEmpty(self) === false;
```

## Barrel（`index.ts`）

手动维护，每个模块一行：

```ts
export { absurd, cast, flow, hole, identity, pipe } from "./Function.ts";
export * as Array from "./Array.ts";
export * as Effect from "./Effect.ts";
// ...
```

新增模块时加一行 `export * as Foo from "./Foo.ts"`。

## package.json exports

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.ts",
    "./testing": "./src/testing/index.ts",
    "./internal/*": null,
    "./*/index": null
  }
}
```

## 迁移步骤（从扁平文件-模块结构）

### 1. 创建 `internal/` 目录，提取实现

共享辅助函数 → `internal/shared.ts`，模块特有的 → `internal/{module}.ts`，核心运行时 → `internal/core.ts`。

### 2. 更新 import 路径

```diff
- import { isArrayNonEmpty } from "./Array.ts"
+ import * as internalArray from "./internal/array.ts"
```

### 3. package.json 屏蔽 internal

```json
{ "exports": { "./internal/*": null } }
```

### 4. 更新 barrel

手动维护 `index.ts`，用 `export * as Module` 模式。

### 5. 添加 JSDoc

文件顶部模块描述，每个导出项加 `@category`、`@since`。

## 实施状态

已完成 `packages/core` 的模块重组：公共模块位于 `src/*.ts`，内部实现位于 `src/internal/`，根级 `index.ts` 和 package exports 已更新，旧领域目录和 `interal` 拼写路径已移除。`@open-insight/core` 的现有命名空间入口保持可用，仓库内深层导入已迁移到新的根级模块路径。
