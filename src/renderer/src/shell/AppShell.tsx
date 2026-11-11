import { Breadcrumb, ConsoleBrand, ConsoleNav, ConsoleShell } from '@lobehub/ui/dashboard'
import { useEffect, useMemo, useRef } from 'react'

import logoMarkUrl from '../assets/logo-mark.png'
import logoWordmarkDarkUrl from '../assets/logo-wordmark-dark.png'
import logoWordmarkLightUrl from '../assets/logo-wordmark-light.png'
import { AccountsPage } from '../pages/AccountsPage'
import { AccountVideoPage } from '../pages/AccountVideoPage'
import { PlaceholderPage } from '../pages/PlaceholderPage'
import { ResearchPage } from '../pages/ResearchPage'
import { ResearchVideoPage } from '../pages/ResearchVideoPage'
import { TrackPage } from '../pages/TrackPage'
import { WorkbenchPage } from '../pages/WorkbenchPage'
import {
  isAccountVideoPath,
  isResearchVideoPath,
  isSettingsPath,
  navigate,
  parseAccountVideoParams,
  parseResearchVideoId,
  type MainHref,
} from '../routes'
import { SettingsView } from '../settings/SettingsView'
import { useHashRoute } from '../hooks/useHashRoute'
import { ThemeSwitch } from '../theme/ThemeRoot'
import { mainNav, settingsNav } from './nav'
import { SettingsButton } from './SettingsButton'
import { TikHubBalance } from './TikHubBalance'
import { WindowControls } from './WindowControls'

export function AppShell() {
  const path = useHashRoute()
  const inSettings = isSettingsPath(path)
  const researchVideoId = parseResearchVideoId(path)
  const accountVideo = parseAccountVideoParams(path)
  const navPath = isResearchVideoPath(path)
    ? '/research'
    : isAccountVideoPath(path)
      ? '/accounts'
      : path
  const currentMain = mainNav.find((item) => item.href === navPath)
  const currentSettings = settingsNav.find((item) => item.href === path)
  const lastMain = useRef<MainHref>('/workbench')

  useEffect(() => {
    if (currentMain) lastMain.current = currentMain.href
  }, [currentMain])

  const breadcrumbItems = useMemo(() => {
    if (inSettings) {
      return [
        {
          label: mainNav.find((item) => item.href === lastMain.current)?.label ?? '工作台',
          onClick: () => navigate(lastMain.current),
        },
        { label: '设置' },
        { label: currentSettings?.label ?? '设置' },
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
  ])

  return (
    <ConsoleShell
      brand={
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
      }
      breadcrumb={<Breadcrumb items={breadcrumbItems} label="当前位置" />}
      closeNavigationLabel="关闭导航"
      collapseLabel="收起侧栏"
      expandLabel="展开侧栏"
      footer={
        <div className="sidebar-footer">
          <TikHubBalance />
          <div className="sidebar-footer__actions">
            <ThemeSwitch />
            <SettingsButton active={inSettings} />
          </div>
        </div>
      }
      navigation={
        <ConsoleNav
          items={mainNav.map((item) => ({
            href: item.href,
            icon: item.icon,
            label: item.label,
          }))}
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
      {inSettings ? (
        <SettingsView path={path} onBack={() => navigate(lastMain.current)} />
      ) : path === '/workbench' ? (
        <WorkbenchPage />
      ) : path === '/track' ? (
        <TrackPage />
      ) : researchVideoId ? (
        <ResearchVideoPage videoId={researchVideoId} />
      ) : path === '/research' ? (
        <ResearchPage />
      ) : accountVideo ? (
        <AccountVideoPage accountId={accountVideo.accountId} awemeId={accountVideo.awemeId} />
      ) : path === '/accounts' ? (
        <AccountsPage />
      ) : currentMain ? (
        <PlaceholderPage item={currentMain} />
      ) : (
        <WorkbenchPage />
      )}
    </ConsoleShell>
  )
}
