<template>
  <section class="entity-detail card">
    <div v-if="loading" class="detail-state">加载实体详情中...</div>
    <div v-else-if="error" class="detail-state detail-error">{{ error }}</div>
    <div v-else-if="!entity" class="detail-state">选择左侧图谱中的实体查看详情</div>

    <template v-else>
      <header class="detail-header">
        <div>
          <h3 class="detail-title">{{ label }}</h3>
          <p class="detail-subtitle">
            <span class="type-chip">{{ entity.type || 'Entity' }}</span>
            <span class="detail-uri">{{ entity.uri }}</span>
          </p>
        </div>
      </header>

      <section class="detail-section">
        <h4>属性</h4>
        <dl v-if="propertyEntries.length > 0" class="property-grid">
          <template v-for="[key, value] in propertyEntries" :key="key">
            <dt>{{ key }}</dt>
            <dd>{{ value }}</dd>
          </template>
        </dl>
        <p v-else class="empty-note">暂无属性</p>
      </section>

      <section class="detail-section">
        <h4>关系</h4>
        <div v-if="outgoing.length === 0 && incoming.length === 0" class="empty-note">暂无关系</div>
        <div v-else class="relation-columns">
          <div>
            <p class="relation-heading">出边 ({{ outgoing.length }})</p>
            <ul class="relation-list">
              <li v-for="(relation, index) in outgoing" :key="`out-${index}`">
                <span class="predicate">{{ localName(relation.predicate) }}</span>
                <button
                  v-if="relation.target"
                  type="button"
                  class="link-button"
                  @click="selectUri(relation.target)"
                >
                  {{ relation.target }}
                </button>
              </li>
            </ul>
          </div>
          <div>
            <p class="relation-heading">入边 ({{ incoming.length }})</p>
            <ul class="relation-list">
              <li v-for="(relation, index) in incoming" :key="`in-${index}`">
                <span class="predicate">{{ localName(relation.predicate) }}</span>
                <button
                  v-if="relation.source"
                  type="button"
                  class="link-button"
                  @click="selectUri(relation.source)"
                >
                  {{ relation.source }}
                </button>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section class="detail-section">
        <h4>时间线</h4>
        <ol v-if="timeline.length > 0" class="timeline">
          <li v-for="(entry, index) in timeline" :key="`timeline-${index}`">
            <span class="timeline-time">{{ formatTime(entry.at) }}</span>
            <span class="timeline-event">{{ entry.event }}</span>
            <span v-if="entry.actor" class="timeline-actor">{{ entry.actor }}</span>
            <button
              v-if="entry.evidence"
              type="button"
              class="link-button evidence-link"
              @click="emit('select', entry.evidence)"
            >
              依据
            </button>
          </li>
        </ol>
        <p v-else class="empty-note">暂无时间线（仅报销单提供解释链）</p>
      </section>

      <section class="detail-section">
        <h4>原因（why）</h4>
        <ul v-if="why.length > 0" class="why-list">
          <li v-for="(entry, index) in why" :key="`why-${index}`">
            <span class="why-code">{{ entry.code }}</span>
            <span class="why-message">{{ entry.message }}</span>
            <span class="evidence-group">
              <button
                v-for="(uri, evidenceIndex) in entry.evidence"
                :key="`why-evidence-${index}-${evidenceIndex}`"
                type="button"
                class="link-button evidence-link"
                @click="emit('select', uri)"
              >
                {{ shortUri(uri) }}
              </button>
            </span>
          </li>
        </ul>
        <p v-else class="empty-note">暂无原因说明</p>
      </section>

      <section class="detail-section">
        <h4>证据链接</h4>
        <div v-if="allEvidence.length > 0" class="evidence-links">
          <button
            v-for="(uri, index) in allEvidence"
            :key="`evidence-${index}`"
            type="button"
            class="link-button evidence-link"
            @click="emit('select', uri)"
          >
            {{ shortUri(uri) }}
          </button>
        </div>
        <p v-else class="empty-note">暂无证据</p>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { EntityDetail, Explanation } from '../../api/ontology'
import { localName } from './utils'

const props = withDefaults(
  defineProps<{
    entity: EntityDetail | null
    explanation?: Explanation | null
    loading?: boolean
    error?: string | null
  }>(),
  {
    explanation: null,
    loading: false,
    error: null,
  },
)

const emit = defineEmits<{
  (event: 'select', uri: string): void
}>()

const propertyEntries = computed(() => Object.entries(props.entity?.properties ?? {}))

const outgoing = computed(() =>
  (props.entity?.relations?.outgoing ?? []).filter((relation) => !!relation.target),
)

const incoming = computed(() =>
  (props.entity?.relations?.incoming ?? []).filter((relation) => !!relation.source),
)

const timeline = computed(() => props.explanation?.timeline ?? [])
const why = computed(() => props.explanation?.why ?? [])

const label = computed(() => {
  const properties = props.entity?.properties ?? {}
  return (
    properties.title ||
    properties.serialNo ||
    properties.name ||
    properties.fileName ||
    localName(props.entity?.uri) ||
    props.entity?.type ||
    '实体'
  )
})

const allEvidence = computed(() => {
  const collected = new Set<string>(props.explanation?.evidenceUris ?? [])
  for (const entry of why.value) {
    for (const uri of entry.evidence) collected.add(uri)
  }
  for (const entry of timeline.value) {
    if (entry.evidence) collected.add(entry.evidence)
  }
  return [...collected]
})

function selectUri(uri?: string): void {
  if (uri) emit('select', uri)
}

function shortUri(uri: string): string {
  const name = localName(uri)
  return name || uri
}

function formatTime(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
</script>

<style scoped>
.entity-detail {
  min-height: 560px;
  padding: 16px 18px;
}
.detail-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 500px;
  color: var(--text-secondary);
  font-size: 0.88rem;
  text-align: center;
  padding: 0 20px;
}
.detail-error {
  color: #b42318;
}
.detail-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 12px;
}
.detail-title {
  margin: 0 0 4px;
  font-size: 1.05rem;
  color: var(--text-primary);
}
.detail-subtitle {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 0.76rem;
  color: var(--text-secondary);
}
.type-chip {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(72, 184, 168, 0.15);
  color: #2c7a70;
  font-weight: 600;
}
.detail-uri {
  word-break: break-all;
}
.detail-section {
  margin-top: 16px;
}
.detail-section h4 {
  margin: 0 0 8px;
  font-size: 0.86rem;
  color: var(--text-secondary);
}
.property-grid {
  display: grid;
  grid-template-columns: minmax(90px, 150px) 1fr;
  gap: 6px 12px;
  margin: 0;
  font-size: 0.82rem;
}
.property-grid dt {
  color: var(--text-secondary);
  font-weight: 600;
}
.property-grid dd {
  margin: 0;
  color: var(--text-primary);
  word-break: break-word;
}
.relation-columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.relation-heading {
  margin: 0 0 4px;
  font-size: 0.78rem;
  color: var(--text-secondary);
}
.relation-list,
.why-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.8rem;
}
.relation-list li,
.why-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.predicate {
  font-weight: 600;
  color: var(--text-secondary);
}
.link-button {
  border: none;
  background: none;
  padding: 0;
  color: #2563eb;
  font-size: inherit;
  cursor: pointer;
  text-align: left;
  word-break: break-all;
}
.link-button:hover {
  text-decoration: underline;
}
.timeline {
  list-style: none;
  margin: 0;
  padding: 0 0 0 12px;
  border-left: 2px solid rgba(72, 184, 168, 0.35);
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 0.8rem;
}
.timeline li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.timeline-time {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.timeline-event {
  font-weight: 600;
  color: var(--text-primary);
}
.timeline-actor {
  color: var(--text-secondary);
}
.why-code {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 6px;
  background: rgba(232, 120, 176, 0.14);
  color: #a03a72;
  font-weight: 600;
  font-size: 0.74rem;
}
.why-message {
  color: var(--text-primary);
}
.evidence-group,
.evidence-links {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.evidence-link {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 6px;
  background: rgba(37, 99, 235, 0.08);
  font-size: 0.74rem;
}
.empty-note {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
}
</style>
