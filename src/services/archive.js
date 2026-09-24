// 已完成事项存档：独立模块，数据单独持久化（storage.js 中的 archive 键）。
// 事项流转到 done 后调用 archiveRepair 从活动列表移入存档。

export function archiveRepair(archived, repair) {
  if (repair.status !== "done") throw new Error("只有已完成的事项可以存档");
  const entry = { ...repair, archivedAt: new Date().toISOString() };
  archived.unshift(entry);
  return entry;
}

export function removeFromArchive(archived, id) {
  return archived.filter((entry) => entry.id !== id);
}
