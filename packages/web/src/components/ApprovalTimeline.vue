<template>
  <div class="card">
    <h3 class="card-section-title font-heading">审批流程</h3>
    <div v-if="ruleName" class="rule-name">规则：{{ ruleName }}</div>
    <div v-if="items.length === 0" class="no-data">暂无审批记录</div>
    <div v-else class="timeline">
      <div v-for="(step, i) in items" :key="i" class="timeline-step" :class="{ last: i === items.length - 1 }">
        <div class="timeline-dot" :class="{ done: step.done, current: step.active }"></div>
        <div class="timeline-content">
          <div class="timeline-title">{{ step.title }}</div>
          <div class="timeline-desc">{{ step.desc }}</div>
          <div class="timeline-time" v-if="step.time">{{ step.time }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  items: Array<{ title: string; desc: string; time: string; done: boolean; active: boolean }>
  ruleName?: string
}>()
</script>

<style scoped>
.timeline { position: relative; padding-left: 24px; }
.timeline-step { position: relative; padding-bottom: 20px; }
.timeline-step.last { padding-bottom: 0; }
.timeline-dot {
  position: absolute; left: -20px; top: 4px;
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--border); border: 2px solid var(--border);
}
.timeline-dot.done { background: var(--accent-mint); border-color: var(--accent-mint); }
.timeline-dot.current { background: var(--accent-coral); border-color: var(--accent-coral); box-shadow: 0 0 0 4px rgba(255,107,107,0.15); }
.timeline-step:not(.last)::before {
  content: ''; position: absolute; left: -15px; top: 18px;
  width: 2px; height: calc(100% - 2px); background: var(--border-light);
}
.timeline-title { font-size: 0.9rem; font-weight: 600; color: var(--text-primary); }
.timeline-desc { font-size: 0.8rem; color: var(--text-muted); margin-top: 2px; }
.rule-name { font-size: 0.78rem; color: var(--accent-sky); margin-bottom: 10px; padding: 4px 10px; background: var(--accent-sky-bg); border-radius: var(--radius-sm); display: inline-block; }
.no-data { font-size: 0.85rem; color: var(--text-muted); padding: 20px 0; text-align: center; }
</style>
