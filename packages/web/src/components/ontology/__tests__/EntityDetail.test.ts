import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import EntityDetail from '../EntityDetail.vue'
import type { EntityDetail as EntityDetailModel, Explanation } from '../../../api/ontology'

const REPORT_URI = 'https://sse.local/report/r1'
const PERSON_URI = 'https://sse.local/person/p1'
const APPROVAL_URI = 'https://sse.local/approval/a1'
const RULE_URI = 'https://sse.local/rule/rule-1'
const APPROVER_URI = 'https://sse.local/person/p2'

const entity: EntityDetailModel = {
  uri: REPORT_URI,
  type: 'ExpenseReport',
  properties: {
    title: '差旅报销',
    serialNo: 'RE-001',
    status: 'pending',
  },
  relations: {
    outgoing: [
      { predicate: 'https://sse.local/ontology#submittedBy', target: PERSON_URI },
    ],
    incoming: [
      { predicate: 'https://sse.local/ontology#hasApproval', source: APPROVAL_URI },
    ],
  },
}

const explanation: Explanation = {
  report: REPORT_URI,
  timeline: [
    {
      at: '2026-11-10T08:00:00.000Z',
      event: '提交报销单',
      actor: '张三',
      evidence: REPORT_URI,
    },
  ],
  why: [
    {
      code: 'pending_approval',
      message: '等待审批人处理',
      evidence: [APPROVER_URI],
    },
  ],
  evidenceUris: [RULE_URI],
}

function mountDetail() {
  return mount(EntityDetail, {
    props: { entity, explanation },
  })
}

describe('EntityDetail', () => {
  it('renders properties, relations and the entity header', () => {
    const wrapper = mountDetail()
    const text = wrapper.text()

    expect(text).toContain('差旅报销')
    expect(text).toContain('RE-001')
    expect(text).toContain('pending')
    expect(text).toContain('submittedBy')
    expect(text).toContain('hasApproval')
    expect(text).toContain(REPORT_URI)
  })

  it('renders the explanation timeline and why list', () => {
    const wrapper = mountDetail()
    const text = wrapper.text()

    expect(text).toContain('提交报销单')
    expect(text).toContain('pending_approval')
    expect(text).toContain('等待审批人处理')
  })

  it('emits select when an evidence link is clicked', async () => {
    const wrapper = mountDetail()
    const links = wrapper.findAll('button.evidence-link')
    const ruleLink = links.find((link) => link.text() === 'rule-1')

    expect(ruleLink).toBeTruthy()
    await ruleLink!.trigger('click')

    expect(wrapper.emitted('select')).toBeTruthy()
    expect(wrapper.emitted('select')![0]).toEqual([RULE_URI])
  })

  it('emits select for evidence attached to a why entry', async () => {
    const wrapper = mountDetail()
    const links = wrapper.findAll('button.evidence-link')
    const approverLink = links.find((link) => link.text() === 'p2')

    expect(approverLink).toBeTruthy()
    await approverLink!.trigger('click')

    expect(wrapper.emitted('select')![0]).toEqual([APPROVER_URI])
  })

  it('emits select when a related entity is clicked', async () => {
    const wrapper = mountDetail()
    const relationButton = wrapper
      .findAll('button.link-button')
      .find((button) => button.text() === PERSON_URI)

    expect(relationButton).toBeTruthy()
    await relationButton!.trigger('click')

    expect(wrapper.emitted('select')![0]).toEqual([PERSON_URI])
  })
})
