import { Play } from 'lucide-react'
import { useEffect, useState } from 'react'

import { resolveMediaUrl } from '../mockMedia'

export function VideoCoverThumb({
  coverUrl,
  title,
  onPlay,
}: {
  coverUrl: string | null
  title: string
  onPlay: () => void
}) {
  const resolved = resolveMediaUrl(coverUrl) ?? coverUrl
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    setBroken(false)
  }, [resolved])

  const showImage = Boolean(resolved) && !broken

  return (
    <button
      aria-label={`播放 ${title}`}
      className="research-cover-thumb"
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onPlay()
      }}
    >
      {showImage ? (
        <img
          alt=""
          className="research-cover-thumb__img"
          referrerPolicy="no-referrer"
          src={resolved!}
          onError={() => {
            setBroken(true)
          }}
        />
      ) : (
        <div className="research-cover-thumb__empty" />
      )}
      <span className="research-cover-thumb__play">
        <Play size={14} />
      </span>
    </button>
  )
}
