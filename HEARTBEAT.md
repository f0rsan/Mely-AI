# HEARTBEAT.md

## Mely AI delivery heartbeat (enabled)

- If current time is at/after each full hour and no Mely AI update has been sent in this hour, send a concise progress update to the user.
- Progress update template:
  - 当前里程碑
  - 总体完成百分比（0-100%）
  - 本小时完成
  - 下一小时计划
  - 风险/阻塞（若无则写“无阻塞”）
- If no new progress in this hour, still send a short status ping: "本小时无新增提交，正在执行中的任务：...".

## Active task focus
- Phase B / M1: backend DB persistence + frontend real API integration + smoke tests.
