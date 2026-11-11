import { BarList, CategoryBar } from '@lobehub/charts'
import { Flexbox, Text } from '@lobehub/ui'
import { Surface } from '@lobehub/ui/dashboard'

import type { AccountPortraitBlock, AccountPortraitSlice } from '../../../shared/accountAnalysis'

const FORMAT_LABELS = new Set(['口播', '带货', '探店', '教程', '剧情', '资讯', '其他', '混剪', 'Vlog', 'vlog'])

function isBadInterestLabel(label: string): boolean {
  if (FORMAT_LABELS.has(label)) return true
  if (label.length > 18) return true
  if (/\[[^\]]+\]/.test(label)) return true
  if (/谢谢|老家|大表姐|加油|慕了|求链接|666|哈哈哈/.test(label)) return true
  return false
}

function positiveSlices(slices: AccountPortraitSlice[], kind: 'raw' | 'interest' = 'raw') {
  return slices
    .filter((item) => item.share > 0)
    .filter((item) => (kind === 'interest' ? !isBadInterestLabel(item.label) : true))
    .map((item) => ({ name: item.label, value: item.share }))
    .sort((a, b) => b.value - a.value)
}

function GenderSplit({ slices }: { slices: AccountPortraitSlice[] }) {
  const data = positiveSlices(slices)
  if (data.length === 0) {
    return <Text type="secondary">暂无性别倾向数据</Text>
  }

  const values = data.map((item) => item.value)
  return (
    <div className="account-portrait-metric">
      <div className="account-portrait-metric__head">
        <Text type="secondary">性别倾向</Text>
        <Text className="account-portrait-metric__legend" type="secondary">
          {data.map((item) => `${item.name} ${String(item.value)}%`).join(' · ')}
        </Text>
      </div>
      <CategoryBar
        showLabels={false}
        size={10}
        valueFormatter={(value) => `${String(value)}%`}
        values={values}
      />
    </div>
  )
}

function ShareBars({
  title,
  slices,
  hint,
}: {
  title: string
  slices: AccountPortraitSlice[]
  hint?: string
}) {
  const data = positiveSlices(slices, title === '兴趣分布' ? 'interest' : 'raw')
  if (data.length === 0) {
    return (
      <div className="account-portrait-metric">
        <Text type="secondary">{title}</Text>
        <Text type="secondary">
          {title === '兴趣分布' ? '暂无可用兴趣主题，点刷新后会按标题/赛道重算' : '暂无数据'}
        </Text>
      </div>
    )
  }

  return (
    <div className="account-portrait-metric">
      <div className="account-portrait-metric__head">
        <Text type="secondary">{title}</Text>
        {hint ? (
          <Text className="account-portrait-metric__legend" type="secondary">
            {hint}
          </Text>
        ) : null}
      </div>
      <BarList
        data={data}
        sortOrder="descending"
        valueFormatter={(value) => `${String(value)}%`}
      />
    </div>
  )
}

function TraitChips({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) {
    return (
      <Text type="secondary">
        {label}：—
      </Text>
    )
  }

  return (
    <div className="account-portrait-traits">
      <Text type="secondary">{label}</Text>
      <div className="account-portrait-traits__list">
        {items.map((item) => (
          <span key={item} className="account-portrait-chip" title={item}>
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

export function PortraitPanel({
  title,
  block,
}: {
  title: string
  block: AccountPortraitBlock
}) {
  return (
    <Surface className="account-portrait-surface" title={title}>
      <Flexbox gap={14}>
        <Text>{block.summary || '暂无摘要'}</Text>
        <div className="account-portrait-body">
          <GenderSplit slices={block.gender} />
          <ShareBars slices={block.age} title="年龄倾向" />
          <ShareBars
            hint="观众更可能关心的主题，不是视频体裁或原评论"
            slices={block.interests}
            title="兴趣分布"
          />
        </div>
        <TraitChips label="关注动机" items={block.motivations} />
        <TraitChips label="活跃特征" items={block.activeTraits} />
      </Flexbox>
    </Surface>
  )
}
