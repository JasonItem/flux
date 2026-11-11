import { Button, Flexbox, Modal, Text } from '@lobehub/ui'
import { ExternalLink, Play } from 'lucide-react'
import { useEffect, useState } from 'react'

import { DouyinTitleLink, resolveDouyinVideoUrl } from './DouyinTitleLink'
import { isAppMockMediaUrl, resolveMediaUrl } from '../mockMedia'

export interface VideoPlayerTarget {
  title: string
  coverUrl: string | null
  playUrl: string | null
  profileUrl: string
  awemeId?: string | null
  authorNickname?: string
}

export function VideoPlayerModal({
  open,
  video,
  onClose,
}: {
  open: boolean
  video: VideoPlayerTarget | null
  onClose: () => void
}) {
  const playUrl = resolveMediaUrl(video?.playUrl)
  const coverUrl = resolveMediaUrl(video?.coverUrl) ?? video?.coverUrl ?? null
  const externalUrl = resolveDouyinVideoUrl({
    profileUrl: video?.profileUrl,
    awemeId: video?.awemeId,
  })
  const canOpenExternal = Boolean(externalUrl) && !isAppMockMediaUrl(externalUrl)
  const [playFailed, setPlayFailed] = useState(false)

  useEffect(() => {
    setPlayFailed(false)
  }, [video?.playUrl, open])

  const showFallback = !playUrl || playFailed

  return (
    <Modal
      destroyOnHidden
      footer={null}
      open={open}
      title={
        video ? (
          <DouyinTitleLink
            awemeId={video.awemeId}
            profileUrl={video.profileUrl}
            title={video.title}
          />
        ) : (
          '视频播放'
        )
      }
      width={720}
      onCancel={onClose}
    >
      {video ? (
        <Flexbox gap={12}>
          {!showFallback ? (
            <video
              autoPlay
              className="research-player-video"
              controls
              key={playUrl}
              poster={coverUrl ?? undefined}
              src={playUrl!}
              onError={() => {
                setPlayFailed(true)
              }}
            />
          ) : (
            <div className="research-player-fallback">
              {coverUrl ? (
                <img
                  alt=""
                  className="research-player-fallback-cover"
                  referrerPolicy="no-referrer"
                  src={coverUrl}
                />
              ) : (
                <div className="research-player-fallback-empty">
                  <Play size={28} />
                </div>
              )}
              <div className="research-player-fallback-mask">
                <Text type="secondary">
                  {playFailed
                    ? '直链已失效或受平台限制，请打开抖音原页观看'
                    : '暂无直链，可打开抖音原页观看'}
                </Text>
                {canOpenExternal && externalUrl ? (
                  <Button
                    icon={ExternalLink}
                    type="primary"
                    onClick={() => {
                      window.open(externalUrl, '_blank', 'noreferrer')
                    }}
                  >
                    打开抖音页面
                  </Button>
                ) : null}
              </div>
            </div>
          )}
          {video.authorNickname ? (
            <Text type="secondary">{video.authorNickname}</Text>
          ) : null}
        </Flexbox>
      ) : null}
    </Modal>
  )
}
