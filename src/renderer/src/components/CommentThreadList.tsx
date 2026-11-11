import { Avatar, Button, Empty, Flexbox, Segmented, Text } from '@lobehub/ui'
import { ChevronDown, ChevronUp, Heart, MessageCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { AccountVideoComment } from '../../../shared/accountAnalysis'
import type { ResearchCommentItem } from '../../../shared/research'

type ThreadComment = ResearchCommentItem | AccountVideoComment

export type CommentSortKey = 'digg' | 'reply' | 'replyRate' | 'quality'

const PAGE_SIZE = 6

function formatCount(value: number): string {
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)}万`
  return String(value)
}

function sortComments(list: ThreadComment[], key: CommentSortKey): ThreadComment[] {
  const rank = (item: ThreadComment) => {
    switch (key) {
      case 'digg':
        return item.diggCount
      case 'reply':
        return item.replyCount
      case 'replyRate':
        return item.replyRate
      case 'quality':
      default:
        return item.qualityScore
    }
  }
  return [...list]
    .map((item) => ({
      ...item,
      replies: sortComments(item.replies ?? [], key),
    }))
    .sort((a, b) => rank(b) - rank(a))
}

function CommentNode({
  comment,
  depth,
}: {
  comment: ThreadComment
  depth: number
}) {
  const childCount = comment.replies?.length ?? 0
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={depth === 0 ? 'comment-thread__item' : 'comment-thread__item is-child'}>
      <Flexbox gap={10} horizontal style={{ alignItems: 'flex-start' }}>
        <Avatar avatar={comment.avatarUrl ?? undefined} size={depth === 0 ? 36 : 28} title={comment.author} />
        <Flexbox gap={4} style={{ minWidth: 0, flex: 1 }}>
          <Text type="secondary">{comment.author}</Text>
          <Text>{comment.content}</Text>
          <Flexbox gap={12} horizontal style={{ alignItems: 'center' }} wrap="wrap">
            <Text fontSize={12} type="secondary">
              <Heart size={12} style={{ marginRight: 4, verticalAlign: '-2px' }} />
              {formatCount(comment.diggCount)}
            </Text>
            <Text fontSize={12} type="secondary">
              <MessageCircle size={12} style={{ marginRight: 4, verticalAlign: '-2px' }} />
              {formatCount(comment.replyCount)}
            </Text>
            <Text fontSize={12} type="secondary">
              回复率 {(comment.replyRate * 100).toFixed(1)}%
            </Text>
            <Text fontSize={12} type="secondary">
              质量 {String(comment.qualityScore)}
            </Text>
          </Flexbox>

          {childCount > 0 ? (
            <div className="comment-thread__toggle">
              <Button
                icon={expanded ? ChevronUp : ChevronDown}
                size="small"
                type="text"
                onClick={() => {
                  setExpanded((prev) => !prev)
                }}
              >
                {expanded ? '收起回复' : `展开 ${String(childCount)} 条回复`}
              </Button>
            </div>
          ) : null}

          {expanded && childCount > 0 ? (
            <div className="comment-thread__children">
              {comment.replies.map((child) => (
                <CommentNode key={child.id} comment={child} depth={depth + 1} />
              ))}
            </div>
          ) : null}
        </Flexbox>
      </Flexbox>
    </div>
  )
}

export function CommentThreadList({ comments }: { comments: ThreadComment[] }) {
  const [sortKey, setSortKey] = useState<CommentSortKey>('quality')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  const sorted = useMemo(() => sortComments(comments, sortKey), [comments, sortKey])
  const visible = sorted.slice(0, visibleCount)
  const hasMore = visibleCount < sorted.length

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [sortKey, comments])

  useEffect(() => {
    const root = scrollerRef.current
    const sentinel = sentinelRef.current
    if (!root || !sentinel || !hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((prev) => Math.min(sorted.length, prev + PAGE_SIZE))
        }
      },
      { root, rootMargin: '80px', threshold: 0 },
    )
    observer.observe(sentinel)
    return () => {
      observer.disconnect()
    }
  }, [hasMore, sorted.length, visible.length])

  return (
    <div className="comment-thread">
      <Flexbox gap={8} horizontal style={{ alignItems: 'center', justifyContent: 'space-between' }} wrap="wrap">
        <Text type="secondary">共 {String(sorted.length)} 条一级评论</Text>
        <Segmented<CommentSortKey>
          options={[
            { label: '质量', value: 'quality' },
            { label: '点赞', value: 'digg' },
            { label: '回复', value: 'reply' },
            { label: '回复率', value: 'replyRate' },
          ]}
          value={sortKey}
          onChange={(value) => {
            setSortKey(value)
          }}
        />
      </Flexbox>

      <div ref={scrollerRef} className="comment-thread__scroller">
        {visible.length === 0 ? (
          <Empty description="暂无评论样本" title="评论为空" />
        ) : (
          visible.map((item) => <CommentNode key={item.id} comment={item} depth={0} />)
        )}
        <div ref={sentinelRef} className="comment-thread__sentinel">
          {hasMore ? (
            <Text type="secondary">下拉加载更多…</Text>
          ) : visible.length > 0 ? (
            <Text type="secondary">已加载全部评论</Text>
          ) : null}
        </div>
      </div>
    </div>
  )
}
