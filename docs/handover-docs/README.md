# SSE 离线备份与恢复 —— 移交包

> 日期：2026-11-09 | 版本：1.0 | 状态：可交接
> 适用系统：SSE 智能报销管理系统（PostgreSQL + MinIO）

---

## 快速开始

**只想了解这套能力是什么** → 读 [`docs/00-总览.md`](docs/00-总览.md)

**要接手继续开发** → 按顺序读：

1. [`docs/01-设计说明.md`](docs/01-设计说明.md) —— 架构与关键技术决策
2. [`docs/04-接入SSE工程方案.md`](docs/04-接入SSE工程方案.md) —— 怎么并进 SSE monorepo
3. [`docs/06-踩坑与已知问题.md`](docs/06-踩坑与已知问题.md) —— **动手前必读**

**要在机器上跑** → 读 [`docs/05-运维手册.md`](docs/05-运维手册.md)

---

## 目录结构

```
sse-offline-recovery/
├── README.md                   ← 本文件
├── docs/                       ← 8 篇文档
│   ├── 00-总览.md              能力地图、快速上手、现状盘点
│   ├── 01-设计说明.md          架构分层、数据模型、关键决策与取舍
│   ├── 02-导出功能设计.md      旧盘 → 备份包（xl.meta 逆向、PG 离线提取）
│   ├── 03-恢复功能设计.md      备份包 → 系统（列对齐、语义转换、回滚）
│   ├── 04-接入SSE工程方案.md   并入 monorepo 的目录/CLI/包设计、分阶段路径
│   ├── 05-运维手册.md          部署、运行、排障、定期任务、安全
│   ├── 06-踩坑与已知问题.md    24 条实测坑（含成因与规避）
│   └── 07-测试与验收.md        测试分层、实测结果矩阵、验收清单
└── tools/                      ← 可执行工具（17 个文件）
    ├── 提取层
    │   ├── probe_oldroot.py        探查旧盘结构
    │   ├── pg_offline_export.py    PGDATA → CSV（postgres --single）
    │   ├── minio_offline_export.py MinIO 数据目录 → 对象
    │   ├── xlmeta_parse.py         xl.meta v2 解析库
    │   └── xlmeta_probe.py         xl.meta 探查工具
    ├── 打包层
    │   ├── build_import_package.py CSV → 单行 INSERT → 备份包
    │   ├── transform_approver_id.py 角色 → UUID 语义转换
    │   ├── filter_insert_columns.py 按目标库真实列对齐
    │   └── colmeta.sql             目标库列元数据查询
    ├── 恢复层
    │   ├── import_sse_data.sh      导入（含自动备份 + 失败回滚）
    │   ├── verify_sse_restore.sh   独立验证（四类交叉校验）
    │   ├── test_rollback.sh        DB 阶段回滚测试
    │   └── test_rollback_minio.sh  MinIO 阶段回滚测试
    └── 既有工具
        ├── export_sse_data.sh      在线逻辑导出
        ├── testdata.sql            测试数据
        ├── README.md               逻辑迁移套件文档
        └── OFFLINE-RECOVERY-README.md  离线恢复操作指南
```

---

## 核心结论速览

| 项 | 结论 |
|---|---|
| 能力边界 | 从只读旧盘导出备份包 → 恢复到运行中的 SSE → 独立验证 → 失败回滚 |
| 关键约束 | **全程不启动旧盘任何服务**；旧盘零写入（实测 1379 文件 0 修改） |
| 数据规模 | 15 张业务表 / 264 行 / 16 个 MinIO 对象 / 3 个 bucket |
| 完整性 | 44/44 文件 checksum 通过；关联命中 15/15 |
| 环境适配 | 宿主机有/无 `psql` 都支持（`PG_CONTAINER` 切换） |
| 验证状态 | host 模式与 container 模式的导入/验证/两类回滚 **全部实测通过** |

---

## 三个必须知道的坑

动手前先看这三条，其余在 [`docs/06-踩坑与已知问题.md`](docs/06-踩坑与已知问题.md)：

1. **`pg_restore` 的 `-f` 是输出文件，不是输入归档** ——
   归档必须走位置参数，否则报 `input file is too short (read 0, expected 5)`。

2. **`storage_key` 带双重 bucket 前缀，`avatar_url` 不带** ——
   `invoices/invoices/<key>` vs `avatars/<url>`，方向相反，不能套同一条规则。

3. **回滚测试在空基线上会"假通过"** ——
   基线为空时必须判 FAIL，否则测试是绿色的但什么都没验证。

---

## 敏感信息提示

本移交包的 `tools/` 目录**不含任何凭据值**（全部为 `[REDACTED]` 或环境变量占位）。

但若你一并分发 `olddisk-package/`（真实备份包），其 `files/` 目录**含真实凭据**
（`mineruToken`、邮箱密码、阿里云 AK/SK 等，均来自旧盘原样恢复）。
分发前请按 [`docs/06-踩坑与已知问题.md` 6.22](docs/06-踩坑与已知问题.md) 处理。
