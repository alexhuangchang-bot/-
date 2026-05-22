# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述
家庭账本 v1.0 - 一个基于发薪周期的个人财务管理 Web 应用，支持本地存储与 Supabase 云同步。

## 技术栈
- 前端：纯 HTML/CSS/JavaScript（无框架）
- 后端：Node.js 简单静态服务器（server.js）
- 数据库：Supabase PostgreSQL + 浏览器 localStorage
- 认证：Supabase Auth

## 核心文件
| 文件 | 用途 |
|------|------|
| index.html | 页面结构与模态框 |
| app.js | 业务逻辑核心（DataStore 类、周期计算、渲染） |
| style.css | 样式文件（参考 https://thariqs.github.io/html-effectiveness） |
| server.js | 本地开发服务器（端口 8080） |
| boot-cloud.js | Supabase 认证与云同步逻辑 |
| supabase-config.js | Supabase 配置（URL/Key） |

## 开发命令
```bash
# 启动本地开发服务器
node server.js
# 访问 http://localhost:8080
```

## 关键业务逻辑
### 发薪周期计算
- 发薪日默认 16 号（可设置）
- 当前日期 ≥ 发薪日：周期为「本月发薪日 ～ 下月发薪日前一天」
- 当前日期 < 发薪日：周期为「上月发薪日 ～ 本月发薪日前一天」

### 金额分配公式
```
交给老婆 = max(0, 本期收入 - 日常预算 - 上月可报销额外支出)
不可报销额外（reimbursable: false）仅统计页记录，不进首页、不扣交给老婆
```

### 数据结构
```javascript
// localStorage Key: familyBudget_v2
{
  settings: { dailyBudget: 6300, payday: 16 },
  incomes: [{ id, amount, source, date }],
  expenses: [{ id, amount, type: 'extra', reimbursable: true|false, category, date, note }],
  categories: { daily: [...], extra: [...] }
}
```

### Supabase 表
- **表名**: household_budget
- **字段**: user_id (uuid), payload (jsonb), updated_at (timestamptz)
- **RLS**: 用户只能读写自己的数据

## 项目约定
- 所有面向用户的文案使用中文
- 金额使用人民币 ¥ 符号
- 样式风格参考 thariqs.github.io/html-effectiveness
- 代码注释：仅在非显而易见的业务逻辑处添加
