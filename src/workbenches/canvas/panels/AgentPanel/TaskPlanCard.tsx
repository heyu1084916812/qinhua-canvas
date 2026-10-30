import { useState } from 'react'
import {
  agentTaskPlanProgress,
  type AgentTaskPlan,
  type AgentTaskPlanStep,
} from '../../../../domain/agent/taskPlan'
import {
  IconCheck,
  IconChevronDown,
  IconClose,
  IconPause,
  IconSpinner,
} from '../../toolbar/icons'
import styles from './TaskPlanCard.module.css'

export function TaskPlanCard({
  plan,
  pendingConfirmationStepId,
  currentActivity,
}: {
  plan: AgentTaskPlan
  pendingConfirmationStepId?: string
  currentActivity?: {
    running: boolean
    text: string
  }
}) {
  const [expanded, setExpanded] = useState(true)
  const progress = agentTaskPlanProgress(plan)
  const completed = progress.status === 'completed'
  return (
    <section
      className={styles.plan}
      data-agent-task-plan={plan.id}
      data-agent-task-plan-status={progress.status}
      data-agent-task-plan-progress={`${progress.completed}/${progress.total}`}
      aria-label={`任务计划：${plan.title}`}
    >
      <span className={styles.srOnly} role="status">
        {progress.status === 'completed'
          ? `${plan.title}已全部完成`
          : progress.current
            ? `${plan.title}当前步骤：${progress.current.title}，已完成 ${progress.completed}/${progress.total}`
            : `${plan.title}已完成 ${progress.completed}/${progress.total}`}
      </span>
      <button
        type="button"
        className={styles.head}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        data-agent-task-plan-toggle
      >
        <span className={styles.titleBlock}>
          <span className={styles.kicker}>
            {completed
              ? '本次创作已完成'
              : progress.current
                ? `执行计划 · 当前：${progress.current.title}`
                : '等待下一步开始'}
          </span>
          <span className={styles.title}>{plan.title}</span>
        </span>
        <span className={styles.count}>
          {progress.completed}/{progress.total}
        </span>
        <IconChevronDown
          size={14}
          className={expanded ? styles.chevronOpen : styles.chevron}
        />
      </button>

      <div
        className={styles.track}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.completed}
        aria-label={`已完成 ${progress.completed} / ${progress.total} 步`}
      >
        <span
          className={completed ? styles.fillDone : styles.fill}
          style={{ transform: `scaleX(${progress.percent / 100})` }}
        />
      </div>

      {expanded && (
        <ol className={styles.steps}>
          {plan.steps.map((step, index) => (
            <StepRow
              key={step.id}
              step={step}
              index={index}
              current={plan.currentStepId === step.id}
              awaitingConfirmation={pendingConfirmationStepId === step.id}
              activity={
                plan.currentStepId === step.id && currentActivity
                  ? currentActivity
                  : undefined
              }
            />
          ))}
        </ol>
      )}
    </section>
  )
}

function StepRow({
  step,
  index,
  current,
  awaitingConfirmation,
  activity,
}: {
  step: AgentTaskPlanStep
  index: number
  current: boolean
  awaitingConfirmation: boolean
  activity?: {
    running: boolean
    text: string
  }
}) {
  const done = step.status === 'done' || step.status === 'skipped'
  const failed = step.status === 'failed'
  const awaitingReview =
    step.status === 'in_progress' &&
    Boolean(step.resultsReadyAt) &&
    !step.reviewApprovedAt
  const active =
    (awaitingConfirmation || step.status === 'in_progress') &&
    !awaitingReview
  return (
    <li
      className={styles.step}
      data-agent-task-step={step.id}
      data-agent-task-step-current={current ? 'true' : undefined}
      data-agent-task-step-status={
        awaitingConfirmation
          ? 'awaiting_confirmation'
          : awaitingReview
            ? 'awaiting_review'
            : step.status
      }
      aria-current={current ? 'step' : undefined}
    >
      <span
        className={
          done
            ? styles.markDone
            : failed
              ? styles.markFailed
              : active
                ? styles.markActive
                : styles.markPending
        }
        aria-hidden="true"
      >
        {done ? (
          <IconCheck size={12} />
        ) : failed ? (
          <IconClose size={11} />
        ) : awaitingConfirmation || awaitingReview ? (
          <IconPause size={11} />
        ) : active ? (
          <IconSpinner size={12} className={styles.spinner} />
        ) : (
          <span>{index + 1}</span>
        )}
      </span>
      <span className={styles.stepBody}>
        <span className={styles.srOnly}>
          状态：
          {awaitingConfirmation
            ? '等待确认'
            : awaitingReview
              ? '结果待验收'
            : step.status === 'done'
              ? '已完成'
              : step.status === 'failed'
                ? '失败'
                : step.status === 'skipped'
                  ? '已跳过'
                  : step.status === 'in_progress'
                    ? '进行中'
                    : '待开始'}
        </span>
        <span className={done ? styles.stepTitleDone : styles.stepTitle}>
          {step.title}
        </span>
        {step.detail && <span className={styles.detail}>{step.detail}</span>}
        {step.note && <span className={styles.note}>{step.note}</span>}
        {activity ? (
          <span
            className={styles.activity}
            data-agent-task-step-activity={activity.running ? 'running' : 'idle'}
          >
            <span className={styles.activityText}>{activity.text}</span>
          </span>
        ) : null}
      </span>
      {awaitingConfirmation ? (
        <span className={styles.confirmTag}>等待你确认</span>
      ) : awaitingReview ? (
        <span className={styles.confirmTag}>结果待验收</span>
      ) : step.requiresConfirmation && !done ? (
        <span className={styles.softTag}>完成需验收</span>
      ) : null}
    </li>
  )
}
