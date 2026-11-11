import { Button, Flexbox, Modal, Text } from '@lobehub/ui'
import { ExternalLink, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { DouyinTitleLink, resolveDouyinVideoUrl } from './DouyinTitleLink'
import { isAppMockMediaUrl, resolveMediaUrl } from '../mockMedia'
import { getStudio } from '../studioApi'

export interface VideoPlayerTarget {
  title: string
  coverUrl: string | null
  playUrl: string | null
  profileUrl: string
  awemeId?: string | null
  researchVideoId?: string
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
  const [playUrlOverride, setPlayUrlOverride] = useState<string | null>(null)
  const [playFailed, setPlayFailed] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const retried = useRef(false)

  const playUrl = resolveMediaUrl(playUrlOverride ?? video?.playUrl)
  const coverUrl = resolveMediaUrl(video?.coverUrl) ?? video?.coverUrl ?? null
  const externalUrl = resolveDouyinVideoUrl({
    profileUrl: video?.profileUrl,
    awemeId: video?.awemeId,
  })
  const canOpenExternal = Boolean(externalUrl) && !isAppMockMediaUrl(externalUrl)

  useEffect(() => {
    setPlayFailed(false)
    setPlayUrlOverride(null)
    retried.current = false
  }, [video?.playUrl, video?.researchVideoId, video?.awemeId, open])

  useEffect(() => {
    if (
      playUrl?.startsWith('flux-media://') ||
      playUrl?.startsWith('http://127.0.0.1:') ||
      playUrl?.startsWith('http://localhost:')
    ) {
      setPlayFailed(false)
      retried.current = false
    }
  }, [playUrl])

  const retryDownload = async () => {
    if (retried.current || retrying || !video) return
    retried.current = true
    setRetrying(true)
    try {
      if (video.researchVideoId) {
        const next = await getStudio().research.ensureLocalMedia(video.researchVideoId, {
          force: true,
        })
        if (next.playUrl) setPlayUrlOverride(next.playUrl)
        setPlayFailed(false)
      } else if (video.awemeId) {
        const next = await getStudio().media.ensureByAwemeId(video.awemeId, {
          playUrl: video.playUrl,
          force: true,
        })
        setPlayUrlOverride(next.playUrl)
        setPlayFailed(false)
      } else {
        setPlayFailed(true)
      }
    } catch {
      setPlayFailed(true)
    } finally {
      setRetrying(false)
    }
  }

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
                void retryDownload()
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
                  {retrying
                    ? '正在重新下载本地缓存…'
                    : playFailed
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
