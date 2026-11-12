import { Breadcrumb, ConsoleBrand, ConsoleNav, ConsoleShell } from '@lobehub/ui/dashboard'
import { useEffect, useMemo, useRef, useState } from 'react'

import logoMarkUrl from '../assets/logo-mark.png'
import logoWordmarkDarkUrl from '../assets/logo-wordmark-dark.png'
import logoWordmarkLightUrl from '../assets/logo-wordmark-light.png'
import { AccountsPage } from '../pages/AccountsPage'
import { AccountVideoPage } from '../pages/AccountVideoPage'
import { JobsPage } from '../pages/JobsPage'
import { PlaceholderPage } from '../pages/PlaceholderPage'
import { RadarPage } from '../pages/RadarPage'
import { ResearchPage } from '../pages/ResearchPage'
import { ResearchVideoPage } from '../pages/ResearchVideoPage'
import { TrackPage } from '../pages/TrackPage'
import { WorkbenchPage } from '../pages/WorkbenchPage'
import { WorkshopPage } from '../pages/WorkshopPage'
import { WorkshopScriptPage } from '../pages/WorkshopScriptPage'
import {
  isAccountVideoPath,
  isResearchVideoPath,
  isSettingsPath,
  isWorkshopScriptPath,
  navigate,
  parseAccountVideoParams,
  parseResearchVideoId,
  parseWorkshopScriptId,
  type MainHref,
} from '../routes'
import { SettingsView } from '../settings/SettingsView'
import { useHashRoute } from '../hooks/useHashRoute'
import { ThemeSwitch } from '../theme/ThemeRoot'
import { mainNav, settingsNav } from './nav'
import { JobsToaster } from './JobsToaster'
import { TikHubBalance } from './TikHubBalance'
import { WindowControls } from './WindowControls'

export function AppShell() {
  const path = useHashRoute()
  const [activeJobCount, setActiveJobCount] = useState(0)
  const inSettings = isSettingsPath(path)
  const researchVideoId = parseResearchVideoId(path)
  const workshopScriptId = parseWorkshopScriptId(path)
  const accountVideo = parseAccountVideoParams(path)

  useEffect(() => {
    const sync = (jobs: { status: string }[]) => {
      setActiveJobCount(
        jobs.filter((job) => job.status === 'running' || job.status === 'queued').length,
      )
    }
    const studio = window.studio
    if (!studio?.jobs) return
    void studio.jobs.list().then(sync).catch(() => undefined)
    return studio.jobs.onChanged((event) => {
      sync(event.jobs)
    })
  }, [])
  const navPath = isResearchVideoPath(path)
    ? '/research'
    : isWorkshopScriptPath(path)
      ? '/workshop'
      : isAccountVideoPath(path)
        ? '/accounts'
        : inSettings
          ? '/settings'
          : path
  const currentMain = mainNav.find((item) => item.href === navPath)
  const currentSettings = settingsNav.find((item) => item.href === path)
  const lastMain = useRef<MainHref>('/workbench')

  useEffect(() => {
    if (!currentMain) return
    if (currentMain.href === '/settings' || currentMain.href === '/jobs') return
    lastMain.current = currentMain.href
  }, [currentMain])

  const breadcrumbItems = useMemo(() => {
    if (inSettings) {
      return [
        {
          label: mainNav.find((item) => item.href === lastMain.current)?.label ?? '工作台',
          onClick: () => navigate(lastMain.current),
        },
        { label: '系统设置' },
        { label: currentSettings?.label ?? '系统设置' },
      ]
    }

    if (researchVideoId) {
      return [
        {
          label: '样本拆解',
          onClick: () => navigate('/research'),
        },
        { label: '视频详情' },
      ]
    }

    if (workshopScriptId) {
      return [
        {
          label: '创作工坊',
          onClick: () => navigate('/workshop'),
        },
        { label: '脚本详情' },
      ]
    }

    if (accountVideo) {
      return [
        {
          label: '账号分析',
          onClick: () => navigate('/accounts'),
        },
        { label: '单视频分析' },
      ]
    }

    return [{ label: currentMain?.label ?? '工作台' }]
  }, [
    accountVideo,
    currentMain?.label,
    currentSettings?.label,
    inSettings,
    researchVideoId,
    workshopScriptId,
  ])

  return (
    <ConsoleShell
      brand={
        <div className="sidebar-brand">
          <ConsoleBrand
            href="#/workbench"
            label="Flux"
            logo={
              <span className="brand-logo" aria-hidden>
                <img alt="" className="brand-logo__mark" src={logoMarkUrl} />
                <img
                  alt=""
                  className="brand-logo__wordmark brand-logo__wordmark--dark"
                  src={logoWordmarkDarkUrl}
                />
                <img
                  alt=""
                  className="brand-logo__wordmark brand-logo__wordmark--light"
                  src={logoWordmarkLightUrl}
                />
              </span>
            }
            title=""
          />
          <ThemeSwitch />
        </div>
      }
      breadcrumb={<Breadcrumb items={breadcrumbItems} label="当前位置" />}
      closeNavigationLabel="关闭导航"
      collapseLabel="收起侧栏"
      expandLabel="展开侧栏"
      footer={
        <div className="sidebar-footer">
          <TikHubBalance />
        </div>
      }
      navigation={
        <ConsoleNav
          items={mainNav.map((item) => {
            const badge =
              item.href === '/jobs' && activeJobCount > 0
                ? activeJobCount > 99
                  ? 99
                  : activeJobCount
                : undefined
            return {
              href: item.href,
              icon: item.icon,
              label: item.label,
              ...(badge != null ? { badge } : {}),
            }
          })}
          label="主导航"
          pathname={typeof navPath === 'string' ? navPath : '/workbench'}
          onNavigate={(href) => {
            navigate(href as MainHref)
          }}
        />
      }
      openNavigationLabel="打开导航"
      skipToContentLabel="跳到内容"
      storageKey="studio-sidebar"
      tools={<WindowControls />}
    >
      <JobsToaster />
      {inSettings ? (
        <SettingsView path={path} onBack={() => navigate(lastMain.current)} />
      ) : path === '/workbench' ? (
        <WorkbenchPage />
      ) : path === '/track' ? (
        <TrackPage />
      ) : path === '/radar' ? (
        <RadarPage />
      ) : researchVideoId ? (
        <ResearchVideoPage videoId={researchVideoId} />
      ) : path === '/research' ? (
        <ResearchPage />
      ) : workshopScriptId ? (
        <WorkshopScriptPage scriptId={workshopScriptId} />
      ) : path === '/workshop' ? (
        <WorkshopPage />
      ) : accountVideo ? (
        <AccountVideoPage accountId={accountVideo.accountId} awemeId={accountVideo.awemeId} />
      ) : path === '/accounts' ? (
        <AccountsPage />
      ) : path === '/jobs' ? (
        <JobsPage />
      ) : currentMain ? (
        <PlaceholderPage item={currentMain} />
      ) : (
        <WorkbenchPage />
      )}
    </ConsoleShell>
  )
}
