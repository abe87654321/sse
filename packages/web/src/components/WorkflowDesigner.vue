<template>
  <div class="wf-designer">
    <TransitionGroup name="step-list" tag="ul" class="wf-step-list">
      <li
        v-for="(step, i) in steps"
        :key="step.step"
        class="wf-step-card"
        :class="{ 'wf-step-dragging': dragIdx === i }"
        :draggable="true"
        @dragstart="onDragStart($event, i)"
        @dragover="onDragOver"
        @drop="onDrop($event, i)"
        @dragend="onDragEnd"
      >
        <div class="wf-step-header">
          <button
            type="button"
            class="wf-drag-handle"
            :aria-label="`拖拽步骤 ${i + 1} 重新排序`"
            :tabindex="0"
            @keydown="onHandleKeydown($event, i)"
          >
            ⠿
          </button>
          <span class="wf-step-label">
            <label :for="`wf-step-name-${step.step}`">步骤 {{ i + 1 }}</label>
          </span>
          <button
            type="button"
            class="wf-delete-btn"
            :aria-label="`删除步骤 ${i + 1}`"
            @click="removeStep(i)"
          >
            ✕
          </button>
        </div>

        <div class="wf-step-body">
          <div class="wf-field">
            <label :for="`wf-step-name-${step.step}`">步骤名称</label>
            <input
              :id="`wf-step-name-${step.step}`"
              v-model="step.label"
              type="text"
              placeholder="例如：部门经理审批"
            />
          </div>

          <div class="wf-field">
            <label :for="`wf-role-${step.step}`">审批角色</label>
            <select
              :id="`wf-role-${step.step}`"
              v-model="step.role"
              @change="onRoleChange(step)"
            >
              <option value="">无特定角色</option>
              <option value="dept_approver">部门审批人</option>
              <option value="finance">财务</option>
              <option value="admin">管理员</option>
            </select>
          </div>

          <div class="wf-field">
            <label :for="`wf-person-${step.step}`">指定人员</label>
            <div class="wf-person-search">
              <input
                :id="`wf-person-${step.step}`"
                v-model="personSearch[i]"
                type="text"
                placeholder="搜索姓名..."
                autocomplete="off"
                @input="onPersonInput(i)"
                @focus="onPersonFocus(i)"
                @blur="onPersonBlur(i)"
              />
              <ul
                v-if="personResults[i]?.length && personFocused === i"
                class="wf-person-dropdown"
              >
                <li
                  v-for="user in personResults[i]"
                  :key="user.id"
                  class="wf-person-item"
                  @mousedown.prevent="selectPerson(i, user)"
                >
                  <span>{{ user.name }}</span>
                  <span class="text-secondary" style="font-size:0.78rem">{{ user.department }}</span>
                </li>
              </ul>
            </div>
            <div v-if="step.assigneeName" class="wf-person-selected">
              <span class="wf-person-chip">
                {{ step.assigneeName }}
                <button
                  type="button"
                  :aria-label="`移除指定人员 ${step.assigneeName}`"
                  @click="step.assigneeId = undefined; step.assigneeName = undefined"
                >
                  ✕
                </button>
              </span>
            </div>
          </div>

          <div class="wf-field">
            <label>校验状态</label>
            <span v-if="validationLoading[i]" class="wf-validation wf-validation-loading">
              ⏳ 校验中...
            </span>
            <span v-else-if="validationErrors[i]" class="wf-validation wf-validation-warn" role="alert">
              ⚠ {{ validationErrors[i] }}
            </span>
            <span v-else class="wf-validation wf-validation-ok">
              ✅ 可用
            </span>
          </div>

          <div class="wf-field">
            <label :for="`wf-reminder-${step.step}`">
              提醒时间：{{ step.reminderAfterHours ?? 48 }} 小时
            </label>
            <input
              :id="`wf-reminder-${step.step}`"
              v-model.number="step.reminderAfterHours"
              type="range"
              min="1"
              max="168"
              class="wf-slider"
            />
          </div>

          <div class="wf-field">
            <label :for="`wf-escalate-${step.step}`">升级目标</label>
            <select
              :id="`wf-escalate-${step.step}`"
              v-model="step.escalateTo"
            >
              <option value="">无升级</option>
              <option value="finance">财务</option>
              <option value="admin">管理员</option>
            </select>
          </div>
        </div>
      </li>
    </TransitionGroup>

    <button type="button" class="wf-add-btn" @click="addStep">
      + 添加步骤
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useDragSort } from '@/composables/useDragSort'
import api from '@/api/index'

interface ApprovalChainStep {
  step: number
  role?: string
  assigneeId?: string
  assigneeName?: string
  label: string
  reminderAfterHours?: number
  escalateAfterHours?: number
  escalateTo?: string
}

interface UserResult {
  id: string
  name: string
  department: string
}

const steps = defineModel<ApprovalChainStep[]>('steps', { required: true })

const emit = defineEmits<{
  (e: 'update:steps', value: ApprovalChainStep[]): void
}>()

function emitSteps(items: ApprovalChainStep[]) {
  steps.value = items
}

const { dragIdx, onDragStart, onDragOver, onDrop, onDragEnd } = useDragSort(steps, emitSteps)

const personSearch = ref<Record<number, string>>({})
const personResults = ref<Record<number, UserResult[]>>({})
const personFocused = ref<number | null>(null)
const validationErrors = ref<Record<number, string>>({})
const validationLoading = ref<Record<number, boolean>>({})
const tabIndexMap = ref<Record<number, number>>({})

let nextStepNumber = 1
onMounted(() => {
  if (steps.value.length > 0) {
    nextStepNumber = Math.max(...steps.value.map(s => s.step)) + 1
  }
  steps.value.forEach((_, i) => validateStep(i))
})

watch(() => steps.value.length, () => {
  steps.value.forEach((_, i) => validateStep(i))
})

function addStep() {
  const s: ApprovalChainStep = {
    step: nextStepNumber++,
    label: `步骤 ${steps.value.length + 1}`,
    role: '',
    reminderAfterHours: 48,
    escalateTo: '',
  }
  steps.value.push(s)
}

function removeStep(i: number) {
  steps.value.splice(i, 1)
}

function onRoleChange(step: ApprovalChainStep) {
  step.assigneeId = undefined
  step.assigneeName = undefined
}

async function onPersonInput(i: number) {
  const kw = personSearch.value[i]
  if (!kw || kw.length < 1) {
    personResults.value[i] = []
    return
  }
  try {
    const r = await api.get('/admin/users', { params: { keyword: kw } })
    personResults.value[i] = r.data || []
  } catch {
    personResults.value[i] = []
  }
}

function onPersonFocus(i: number) {
  personFocused.value = i
}

function onPersonBlur(i: number) {
  setTimeout(() => { if (personFocused.value === i) personFocused.value = null }, 200)
}

function selectPerson(i: number, user: UserResult) {
  steps.value[i].assigneeId = user.id
  steps.value[i].assigneeName = user.name
  personSearch.value[i] = user.name
  personResults.value[i] = []
  personFocused.value = null
  validateStep(i)
}

async function validateStep(i: number) {
  validationLoading.value[i] = true
  validationErrors.value[i] = ''
  const step = steps.value[i]
  try {
    if (step.role) {
      const r = await api.get('/admin/users/validate')
      const counts = r.data as Record<string, number>
      const roleMap: Record<string, string> = {
        dept_approver: '部门审批人',
        finance: '财务',
        admin: '管理员',
      }
      const label = roleMap[step.role] || step.role
      if ((counts[step.role] ?? 0) === 0) {
        validationErrors.value[i] = `⚠ ${label} — 该角色下没有在职人员`
      }
    }
    if (step.assigneeId) {
      try {
        await api.get(`/admin/users/${step.assigneeId}`)
      } catch {
        validationErrors.value[i] = `⚠ 指定人员 "${step.assigneeName}" — 不存在`
      }
    }
  } catch {
    validationErrors.value[i] = '⚠ 无法校验'
  } finally {
    validationLoading.value[i] = false
  }
}

function onHandleKeydown(e: KeyboardEvent, i: number) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const targetIdx = e.key === 'ArrowDown' ? i + 1 : i - 1
    if (targetIdx < 0 || targetIdx >= steps.value.length) return
    const copy = [...steps.value]
    const [moved] = copy.splice(i, 1)
    copy.splice(targetIdx, 0, moved)
    steps.value = copy
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    ;(e.target as HTMLElement).blur()
  }
}
</script>

<style scoped>
.wf-designer {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wf-step-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wf-step-card {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  overflow: hidden;
  transition: all var(--transition);
  box-shadow: var(--shadow-sm);
  cursor: default;
}

.wf-step-card:hover {
  box-shadow: var(--shadow);
}

.wf-step-dragging {
  opacity: 0.5;
  border-color: var(--accent-coral);
}

.wf-step-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--bg-warm);
  border-bottom: 1px solid var(--border-light);
}

.wf-drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  color: var(--text-muted);
  font-size: 1.1rem;
  border-radius: 4px;
  cursor: grab;
  transition: all var(--transition);
  border: none;
  padding: 0;
  line-height: 1;
}

.wf-drag-handle:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.wf-drag-handle:focus-visible {
  outline: 2px solid var(--accent-coral);
  outline-offset: 1px;
  border-radius: 4px;
}

.wf-step-label {
  flex: 1;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.wf-step-label label {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
  cursor: default;
}

.wf-delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.9rem;
  border-radius: var(--radius-sm);
  transition: all var(--transition);
  border: none;
  padding: 0;
}

.wf-delete-btn:hover {
  background: var(--accent-coral-bg);
  color: var(--accent-coral);
}

.wf-delete-btn:focus-visible {
  outline: 2px solid var(--accent-coral);
  outline-offset: 1px;
}

.wf-step-body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wf-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wf-field label {
  font-size: 0.8rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.wf-field input[type="text"],
.wf-field select {
  width: 100%;
  padding: 8px 12px;
  background: var(--bg-input);
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  outline: none;
  transition: border-color var(--transition);
}

.wf-field input[type="text"]:focus,
.wf-field select:focus {
  border-color: var(--accent-coral);
  box-shadow: 0 0 0 3px rgba(255, 107, 107, 0.1);
}

.wf-person-search {
  position: relative;
}

.wf-person-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 20;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lg);
  max-height: 180px;
  overflow-y: auto;
  list-style: none;
  margin-top: 4px;
}

.wf-person-item {
  padding: 8px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  font-size: 0.85rem;
  transition: background var(--transition);
}

.wf-person-item:hover {
  background: var(--bg-hover);
}

.wf-person-selected {
  margin-top: 2px;
}

.wf-person-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  font-size: 0.8rem;
  background: var(--accent-sky-bg);
  color: var(--accent-sky);
  border-radius: var(--radius-full);
}

.wf-person-chip button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  color: var(--accent-sky);
  font-size: 0.7rem;
  padding: 0;
  cursor: pointer;
}

.wf-validation {
  font-size: 0.82rem;
  padding: 4px 0;
}

.wf-validation-ok {
  color: var(--accent-mint);
}

.wf-validation-warn {
  color: var(--accent-coral);
}

.wf-validation-loading {
  color: var(--text-muted);
}

.wf-slider {
  width: 100%;
  accent-color: var(--accent-coral);
}

.wf-add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 12px;
  border: 2px dashed var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-muted);
  font-size: 0.9rem;
  font-weight: 500;
  transition: all var(--transition);
  cursor: pointer;
}

.wf-add-btn:hover {
  border-color: var(--accent-coral);
  color: var(--accent-coral);
  background: var(--accent-coral-bg);
}

.step-list-enter-active,
.step-list-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.step-list-enter-from {
  opacity: 0;
  transform: translateY(-12px);
}

.step-list-leave-to {
  opacity: 0;
  transform: translateX(40px);
}

.step-list-move {
  transition: transform 0.3s;
}
</style>
