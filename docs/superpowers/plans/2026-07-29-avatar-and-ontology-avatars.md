# 头像上传 + 本体人员头像 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现头像上传持久化（MinIO）+ 本体可视化 Person 节点叠加头像显示

**Architecture:** 头像复用 MinIO 存储（与发票相同基础设施），DB `users.avatar_url TEXT` 存 MinIO key。`GET /auth/profile/avatar?userId=` 代理读取 MinIO 图片。本体 Person 节点用 vis-network `circularImage` 形状，无头像时降级为彩色 dot + 标签。

**Tech Stack:** TypeScript, Express, Vue 3, vis-network, MinIO, multer, PostgreSQL

---

## 文件结构

| 文件 | 变更 | 职责 |
|------|------|------|
| `packages/db/src/migrations/008_user_avatar.sql` | 新建 | ALTER TABLE 加 avatar_url 列 |
| `packages/shared/src/types/user.ts:8-21` | 修改 | User 类型加 avatarUrl |
| `packages/core/src/ports/iuser-repo.ts:1-13` | 修改 | IUserRepo 加 updateAvatar |
| `packages/db/src/repositories/pg-user-repo.ts:1-106` | 修改 | 实现 updateAvatar, mapUser+COLUMNS 加 avatar_url |
| `packages/api/src/middleware/upload.ts:1-17` | 修改 | 新增 uploadAvatar multer |
| `packages/api/src/routes/auth.ts:1-122` | 修改 | POST /profile/avatar 上传, GET /profile/avatar 代理读取, login/profile 返回 avatarUrl |
| `packages/web/src/api/auth.ts:1-16` | 修改 | 新增 uploadAvatar |
| `packages/web/src/stores/auth.ts:5-13` | 修改 | UserInfo.avatarUrl |
| `packages/web/src/pages/Profile.vue:1-297` | 修改 | "更换头像"按钮接入上传 |
| `packages/web/src/styles/global.css:272-289` | 修改 | .avatar 支持背景图片 |
| `packages/web/src/layouts/DefaultLayout.vue:40-71` | 修改 | 侧边栏/顶栏头像显示图片 |
| `packages/api/src/routes/ontology.ts:1-223` | 修改 | Person 节点返回 avatarUrl 属性 |
| `packages/web/src/pages/Ontology.vue:109-194` | 修改 | Person 节点 circularImage |

---

### Task 1: DB 迁移 — users 表加 avatar_url

**Files:**
- Create: `packages/db/src/migrations/008_user_avatar.sql`

- [ ] **Step 1: 创建迁移**

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
```

- [ ] **Step 2: Docker 执行**

```bash
sudo docker exec -i sse-postgres-1 psql -U sse -d sse < packages/db/src/migrations/008_user_avatar.sql
```

- [ ] **Step 3: 验证**

```bash
sudo docker exec -i sse-postgres-1 psql -U sse -d sse -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='users' AND column_name='avatar_url';"
```

预期: `avatar_url | text`

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/migrations/008_user_avatar.sql
git commit -m "feat: add avatar_url column to users table"
```

---

### Task 2: 共享类型 + Core 接口 + DB Repo

**Files:**
- Modify: `packages/shared/src/types/user.ts`
- Modify: `packages/core/src/ports/iuser-repo.ts`
- Modify: `packages/db/src/repositories/pg-user-repo.ts`

- [ ] **Step 1: User 类型加 avatarUrl**

`packages/shared/src/types/user.ts`，`status: string` 行后插入：

```typescript
  avatarUrl?: string;
```

- [ ] **Step 2: IUserRepo 加 updateAvatar**

`packages/core/src/ports/iuser-repo.ts`，`getRelatedDataCount` 行前插入：

```typescript
  updateAvatar(id: string, avatarUrl: string): Promise<void>;
```

- [ ] **Step 3: PgUserRepo mapUser 加 avatar_url 映射**

`packages/db/src/repositories/pg-user-repo.ts`，`mapUser` 函数中 `status: row.status,` 后：

```typescript
    avatarUrl: row.avatar_url ?? undefined,
```

- [ ] **Step 4: PgUserRepo USER_COLUMNS 加 avatar_url**

同文件第 21 行，`deleted_at` 后加 `, avatar_url`：

```typescript
const USER_COLUMNS = 'id, name, phone, email, department, role, parent_id, status, deleted_at, avatar_url, created_at, updated_at';
```

- [ ] **Step 5: PgUserRepo 实现 updateAvatar**

同文件，`getRelatedDataCount` 方法前插入：

```typescript
  async updateAvatar(id: string, avatarUrl: string): Promise<void> {
    await pool.query(
      'UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2',
      [avatarUrl, id]
    );
  }
```

- [ ] **Step 6: 编译验证**

```bash
pnpm -r build
```

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types/user.ts packages/core/src/ports/iuser-repo.ts packages/db/src/repositories/pg-user-repo.ts
git commit -m "feat: add avatarUrl to User type, repo interface, and PgUserRepo"
```

---

### Task 3: Multer 配置 + 后端 API 路由

**Files:**
- Modify: `packages/api/src/middleware/upload.ts`
- Modify: `packages/api/src/routes/auth.ts`

- [ ] **Step 1: upload.ts — 新增 uploadAvatar**

在 `packages/api/src/middleware/upload.ts` 末尾追加：

```typescript
export const uploadAvatar = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
      cb(null, true);
    } else {
      cb(new Error('仅支持 PNG 和 JPG 格式的图片'));
    }
  },
});
```

- [ ] **Step 2: auth.ts — 新增 import**

`packages/api/src/routes/auth.ts`，`import { pool } from '@sse/db';` 后追加：

```typescript
import { uploadAvatar } from '../middleware/upload';
import { MinioStorage } from '../storage/minio-storage';
```

- [ ] **Step 3: auth.ts — POST /profile/avatar 上传头像**

`router.put('/password', ...)` 前插入：

```typescript
router.post(
  '/profile/avatar',
  uploadAvatar.single('file'),
  asyncWrap(async (req, res) => {
    if (!req.file) throw new AppError(400, 'INVALID_PARAMS', '请选择图片');

    const minio = new MinioStorage();
    const ext = req.file.originalname.split('.').pop()?.toLowerCase() || 'png';
    const storageKey = `avatars/${req.user!.userId}_${Date.now()}.${ext}`;

    await minio.upload(storageKey, 'avatars', req.file.buffer,
      ext === 'png' ? 'image/png' : 'image/jpeg');

    await userRepo.updateAvatar(req.user!.userId, storageKey);

    res.json({ message: '头像上传成功', avatarUrl: storageKey });
  })
);
```

- [ ] **Step 4: auth.ts — GET /profile/avatar 代理读取头像（支持 ?userId= 查询他人头像）**

上一步 POST 路由后插入：

```typescript
router.get(
  '/profile/avatar',
  asyncWrap(async (req, res) => {
    const targetUserId = (req.query.userId as string) || req.user!.userId;
    const user = await userRepo.findById(targetUserId);
    if (!user?.avatarUrl) throw new AppError(404, 'NOT_FOUND', '未上传头像');

    const minio = new MinioStorage();
    try {
      const data = await minio.getObject(user.avatarUrl, 'avatars');
      const ext = user.avatarUrl.split('.').pop()?.toLowerCase();
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(data);
    } catch {
      throw new AppError(404, 'NOT_FOUND', '头像文件不存在');
    }
  })
);
```

- [ ] **Step 5: auth.ts — GET /profile 返回 avatarUrl**

将 `GET /profile` 的 `res.json(...)` 展开为多行并加 `avatarUrl`：

```typescript
    res.json({
      id: user.id, name: user.name, phone: user.phone, email: user.email,
      department: user.department, role: user.role, avatarUrl: user.avatarUrl,
    });
```

- [ ] **Step 6: auth.ts — POST /login 返回 avatarUrl**

`POST /login` 的 `res.json` 中 `user` 对象，`role: user.role` 后加：

```typescript
        avatarUrl: user.avatarUrl,
```

- [ ] **Step 7: 编译验证**

```bash
pnpm --filter @sse/api build
```

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/middleware/upload.ts packages/api/src/routes/auth.ts
git commit -m "feat: add avatar upload, proxy read with userId param, return avatarUrl"
```

---

### Task 4: 前端 — 头像上传 UI + 侧边栏/顶栏显示

**Files:**
- Modify: `packages/web/src/api/auth.ts`
- Modify: `packages/web/src/stores/auth.ts`
- Modify: `packages/web/src/pages/Profile.vue`
- Modify: `packages/web/src/styles/global.css`
- Modify: `packages/web/src/layouts/DefaultLayout.vue`

- [ ] **Step 1: auth API 加 uploadAvatar**

`packages/web/src/api/auth.ts`，末尾 `}` 前插入：

```typescript
  uploadAvatar(file: File) {
    const formData = new FormData()
    formData.append('file', file)
    return api.post<{ message: string; avatarUrl: string }>(
      '/auth/profile/avatar', formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    )
  },
```

- [ ] **Step 2: auth store UserInfo 加 avatarUrl**

`packages/web/src/stores/auth.ts`，`role: string` 后：

```typescript
  avatarUrl?: string
```

- [ ] **Step 3: global.css — avatar 支持背景图片**

`.avatar-violet` 行后追加：

```css
.avatar-img {
  background-size: cover;
  background-position: center;
}
```

- [ ] **Step 4: Profile.vue — "更换头像"按钮接入上传**

替换模板第 9-11 行为：

```html
        <div class="profile-avatar-section">
          <div
            class="avatar avatar-coral"
            :style="avatarPreview ? { backgroundImage: `url(${avatarPreview})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}"
            style="width:72px;height:72px;font-size:1.8rem;cursor:pointer;"
            @click="triggerAvatarInput"
          >{{ avatarPreview ? '' : userInitial }}</div>
          <input ref="avatarFileInput" type="file" accept="image/png,image/jpeg" style="display:none" @change="handleAvatarChange" />
          <button class="btn-secondary btn-sm" style="margin-top:12px;" @click="triggerAvatarInput">更换头像</button>
        </div>
```

脚本部分，`const userInitial = computed(...)` 行后插入：

```typescript
const avatarFileInput = ref<HTMLInputElement | null>(null)
const avatarPreview = ref(auth.user?.avatarUrl ? `/api/auth/profile/avatar?t=${Date.now()}` : '')

function triggerAvatarInput() {
  avatarFileInput.value?.click()
}

async function handleAvatarChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const res = await authApi.uploadAvatar(file)
    const url = `/api/auth/profile/avatar?t=${Date.now()}`
    avatarPreview.value = url
    if (auth.user) {
      auth.user.avatarUrl = res.data.avatarUrl
      localStorage.setItem('user', JSON.stringify(auth.user))
    }
  } catch (err: any) {
    alert(err?.response?.data?.error?.message || '上传失败')
  }
}
```

- [ ] **Step 5: DefaultLayout.vue — 侧边栏和顶栏头像显示图片**

第 42 行侧边栏头像替换为：

```html
          <div
            class="avatar avatar-coral"
            :style="auth.user?.avatarUrl ? { backgroundImage: `url(/api/auth/profile/avatar?t=${Date.now()})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}"
          >{{ auth.user?.avatarUrl ? '' : userInitial }}</div>
```

第 67 行顶栏头像替换为：

```html
            <div
              class="avatar avatar-coral"
              style="width:34px;height:34px;font-size:0.8rem;"
              :style="auth.user?.avatarUrl ? { backgroundImage: `url(/api/auth/profile/avatar?t=${Date.now()})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}"
            >{{ auth.user?.avatarUrl ? '' : userInitial }}</div>
```

- [ ] **Step 6: 编译验证**

```bash
pnpm --filter @sse/web build
```

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/api/auth.ts packages/web/src/stores/auth.ts packages/web/src/pages/Profile.vue packages/web/src/styles/global.css packages/web/src/layouts/DefaultLayout.vue
git commit -m "feat: avatar upload UI, profile/sidebar/topbar display"
```

---

### Task 5: 本体图谱 — 后端 Person 节点附加 avatarUrl

**Files:**
- Modify: `packages/api/src/routes/ontology.ts`

- [ ] **Step 1: 新增 import 和辅助函数**

`packages/api/src/routes/ontology.ts`：

在 `import { AppError }` 行后加：

```typescript
import { PgUserRepo } from '@sse/db';
```

在 `filterGraph` 函数后、`router.post('/submit-from-text',` 前插入：

```typescript
async function attachAvatars(graph: { nodes: any[]; edges: any[] }): Promise<void> {
  const userRepo = new PgUserRepo();
  for (const node of graph.nodes) {
    if (node.type !== 'Person') continue;
    const p = node.properties || {};
    const userId = p.userId || p.externalId;
    if (!userId) continue;
    try {
      const user = await userRepo.findById(userId);
      if (user?.avatarUrl) {
        node.properties = { ...node.properties, avatarUrl: user.avatarUrl };
      }
    } catch { /* best effort */ }
  }
}
```

- [ ] **Step 2: 各端点调用 attachAvatars**

`GET /graph` 路由中 `res.json(graph)` 前加 `await attachAvatars(graph);`

`POST /from-text` 路由中 `res.json({ graph: extraction, ... })` 前加 `await attachAvatars(extraction);`

`GET /sync` 路由中 `res.json({ message: '本体同步完成', warnings, graph })` 前加 `await attachAvatars(graph);`

`GET /query` 路由中，将 `res.json(getEngine().store.queryByType(type))` 替换为：

```typescript
    const result = getEngine().store.queryByType(type);
    const g = { nodes: result, edges: [] as any[] };
    await attachAvatars(g);
    res.json(g.nodes);
```

- [ ] **Step 3: 编译验证**

```bash
pnpm --filter @sse/api build
```

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/ontology.ts
git commit -m "feat: attach avatarUrl to Person nodes in ontology graph endpoints"
```

---

### Task 6: 本体图谱 — 前端 Person 节点 circularImage

**Files:**
- Modify: `packages/web/src/pages/Ontology.vue`

- [ ] **Step 1: buildVisData() Person 节点分支**

在 `packages/web/src/pages/Ontology.vue` 的 `buildVisData()` 中，`const shape = SHAPES[n.type] || 'dot'` 行之后、`const node: any = {` 行之前插入 Person 分支：

```typescript
    const avatar = n.properties?.avatarUrl
    if (n.type === 'Person' && avatar) {
      const uid = n.properties?.userId || n.properties?.externalId || ''
      return {
        id: n.id,
        label,
        shape: 'circularImage',
        image: `/api/auth/profile/avatar?userId=${encodeURIComponent(uid)}`,
        borderWidth: 3,
        borderWidthSelected: 5,
        color: {
          border: bg,
          background: bg,
          highlight: { border: bg, background: bg },
        },
        size: 24,
        shadow: { enabled: true, color: 'rgba(0,0,0,0.2)', size: 18, x: 0, y: 2 },
        title: nodeTitle(n),
      }
    }
```

- [ ] **Step 2: 编译验证**

```bash
pnpm --filter @sse/web build
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/Ontology.vue
git commit -m "feat: use circularImage shape for Person nodes with avatar in ontology graph"
```

---

### Task 7: 全量验证

- [ ] **Step 1: 启动服务**

```bash
pnpm dev
```

- [ ] **Step 2: 验证头像上传**

访问 `http://localhost:5173/profile`，点击"更换头像"，选择 PNG/JPG 文件。确认：
- 个人中心大头像立即更新
- 侧边栏和顶栏小头像同步更新
- 刷新页面后头像仍在（持久化验证）

- [ ] **Step 3: 验证本体头像**

访问 `http://localhost:5173/ontology`，点击"从数据库同步"。确认：
- Person 节点有头像的显示为圆形头像图片
- 无头像的 Person 节点保持粉色 dot + 名字标签
- 头像加载失败的节点不崩溃（vis-network brokenImage 兜底）

- [ ] **Step 4: 最终提交（如有遗漏文件）**

```bash
git status
git add -A
git commit -m "chore: final verification and cleanup for avatar feature"
git push
```
