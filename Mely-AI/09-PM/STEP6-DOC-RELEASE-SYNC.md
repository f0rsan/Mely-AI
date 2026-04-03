# Step 6 文档同步（release/document-release）

日期：2026-03-20

## 已同步内容
1. **发布说明补充**
   - 收口检查文件：`09-PM/STEP5-SHIP-READINESS-CHECK.md`
2. **QA 报告补充**
   - 联调报告：`08-QA/QA-STEP3-AUTH-PROJECT-SESSION-EXPORT-TUNE.md`
   - 只读 QA 报告：`08-QA/QA-ONLY-REPORT-M3-127.0.0.1-3000.md`
3. **评审问题清单**
   - Step2 评审：`09-PM/GSTACK-STEP2-REVIEW-REPORT.md`

## 变更日志条目（建议粘贴到 PR/Release Note）
- frontend: add `/auth/me` bootstrap and expired-token fallback logout.
- frontend: harden API base URL fallback across dev/prod runtime.
- qa/pm: add gstack step2-7 review, qa-only, ship-readiness and retro deliverables.

## 演示脚本引用
- 现有演示脚本：`09-PM/M3-DEMO-SCRIPT-v1.md`
- 本轮联调脚本：`09-PM/smoke-phase-b.sh`
