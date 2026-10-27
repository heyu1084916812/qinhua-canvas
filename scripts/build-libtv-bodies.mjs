/**
 * 兼容旧命令。正文与 catalog 必须由 UUID 清单一起生成，避免再次出现
 * “导入成功 759 条、发布只映射 704 条”的分叉。
 */
await import('./import-libtv-body-source.mjs')
