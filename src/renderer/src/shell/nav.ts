import type { LucideIcon } from 'lucide-react'
import {
  Bot,
  ChartColumn,
  Clapperboard,
  Compass,
  KeyRound,
  LayoutDashboard,
  PenLine,
  ScrollText,
  Trash2,
  Users,
} from 'lucide-react'

import type { MainHref, SettingsHref } from '../routes'

export interface MainNavItem {
  href: MainHref
  label: string
  description: string
  emptyTitle: string
  emptyDescription: string
  icon: LucideIcon
}

export interface SettingsNavItem {
  href: SettingsHref
  label: string
  description: string
  icon: LucideIcon
}

export const mainNav: readonly MainNavItem[] = [
  {
    href: '/workbench',
    label: '工作台',
    description: '汇总进度、环境检查与下一步操作。',
    emptyTitle: '工作台还没数据',
    emptyDescription: '绑定账号并完成一次自测后，这里会给出下一步建议。',
    icon: LayoutDashboard,
  },
  {
    href: '/track',
    label: '赛道自测',
    description: '拆解账号成分，推荐细分赛道并添加选题。',
    emptyTitle: '还没有自测记录',
    emptyDescription: '开始一次自测后，结果会留在这个页面。',
    icon: Compass,
  },
  {
    href: '/research',
    label: '样本拆解',
    description: '选定选题后筛选样本视频，做文案、结构与评论拆解。',
    emptyTitle: '还没有分析结果',
    emptyDescription: '选择选题并开始分析后，样本会显示在这里。',
    icon: Clapperboard,
  },
  {
    href: '/workshop',
    label: '创作工坊',
    description: '保存与编辑 AI 复刻的口播脚本，从样本思路变成可拍文案。',
    emptyTitle: '还没有脚本',
    emptyDescription: '在样本详情点「复刻脚本」后，生成结果会出现在这里。',
    icon: PenLine,
  },
  {
    href: '/accounts',
    label: '账号分析',
    description: '推断观众/粉丝画像、作品集归类与选题方案。',
    emptyTitle: '还没有分析结果',
    emptyDescription: '选择已绑定账号并开始分析后，结果会显示在这里。',
    icon: ChartColumn,
  },
]

export const settingsNav: readonly SettingsNavItem[] = [
  {
    href: '/settings/accounts',
    label: '账号管理',
    description: '添加、切换和管理要分析的抖音账号（仅国内抖音）。',
    icon: Users,
  },
  {
    href: '/settings/models',
    label: '大模型配置',
    description: '管理 OpenAI 兼容渠道与模型，测试连通性后即可随时调用。',
    icon: Bot,
  },
  {
    href: '/settings/tikhub',
    label: 'TikHub配置',
    description: '配置 TikHub API，用于拉取抖音账号资料与作品数据。',
    icon: KeyRound,
  },
  {
    href: '/settings/cleanup',
    label: '本地数据清理',
    description: '分项清理运行缓存、过期用量日志与可重建分析缓存。',
    icon: Trash2,
  },
  {
    href: '/settings/usage',
    label: 'API用量记录',
    description: '分别查看 TikHub（USD/次数）与大模型（Token）用量与趋势图。',
    icon: ScrollText,
  },
]
