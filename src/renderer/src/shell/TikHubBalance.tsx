import { Text } from '@lobehub/ui'
import { Wallet } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import {
  TikHubSettingsChangedEvent,
  type TikHubBalanceStatus,
} from '../../../shared/tikhub'

const POLL_MS = 60_000

function formatUsd(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '—'
  return `$${value.toFixed(2)}`
}

export function TikHubBalance() {
  const [status, setStatus] = useState<TikHubBalanceStatus | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await window.studio.tikhub.getBalance()
      setStatus(next)
    } catch {
      setStatus({
        ready: false,
        ok: false,
        message: '余额不可用',
        fetchedAt: null,
      })
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, POLL_MS)

    const onSettingsChanged = () => {
      void refresh()
    }
    const onFocus = () => {
      void refresh()
    }

    window.addEventListener(TikHubSettingsChangedEvent, onSettingsChanged)
    window.addEventListener('focus', onFocus)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener(TikHubSettingsChangedEvent, onSettingsChanged)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  if (!status?.ready) return null

  const title = status.ok
    ? [
        status.email,
        `余额 ${formatUsd(status.balance)} USD`,
        `赠额 ${formatUsd(status.freeCredit)} USD`,
      ]
        .filter(Boolean)
        .join(' · ')
    : status.message

  return (
    <div
      className={`tikhub-balance${status.ok ? '' : ' is-error'}`}
      title={title}
    >
      <Wallet aria-hidden className="tikhub-balance__icon" size={16} strokeWidth={1.75} />
      <div className="tikhub-balance__text">
        <Text as="span" className="tikhub-balance__label" type="secondary">
          TikHub 余额
        </Text>
        <Text as="span" className="tikhub-balance__value" weight={600}>
          {status.ok ? formatUsd(status.balance) : '—'}
          {status.ok ? (
            <Text as="span" className="tikhub-balance__unit" type="secondary">
              {' '}
              USD
            </Text>
          ) : null}
        </Text>
      </div>
    </div>
  )
}
