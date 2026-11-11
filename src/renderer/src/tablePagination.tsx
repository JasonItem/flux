import { Select, type SelectProps } from '@lobehub/ui'
import { memo, useMemo } from 'react'

/** LobeUI Pagination 把每页条数写死成英文 “N / page”，这里改成中文 */
const ChinesePageSizeSelect = memo(function ChinesePageSizeSelect(props: SelectProps) {
  const options = useMemo(() => {
    return (props.options ?? []).map((option) => {
      if ('options' in option && Array.isArray(option.options)) {
        return {
          ...option,
          options: option.options.map((item) => {
            const rawValue = 'value' in item ? item.value : undefined
            const numeric = String(rawValue ?? '').replace(/\D/g, '') || String(rawValue ?? '')
            return {
              ...item,
              // 只改文案，保留原始 value 类型（number），避免 Pagination 数字/字符串来回切换死循环
              label: numeric ? `${numeric} 条/页` : item.label,
            }
          }),
        }
      }

      const rawValue = 'value' in option ? option.value : undefined
      const numeric = String(rawValue ?? '').replace(/\D/g, '') || String(rawValue ?? '')
      return {
        ...option,
        label: numeric ? `${numeric} 条/页` : 'label' in option ? option.label : undefined,
      }
    })
  }, [props.options])

  return <Select {...props} options={options} />
})

/**
 * 列表表格默认翻页配置。
 * 注意用 defaultPageSize，不要传受控 pageSize，否则切换「每页条数」会被写死值盖掉。
 */
export function tablePagination(pageSize = 5) {
  return {
    defaultPageSize: pageSize,
    size: 'small' as const,
    showSizeChanger: true,
    pageSizeOptions: [5, 10, 15, 20],
    showTotal: (total: number, range: [number, number]) =>
      `第 ${String(range[0])}–${String(range[1])} 条，共 ${String(total)} 条`,
    hideOnSinglePage: false,
    placement: ['bottomEnd' as const],
    components: {
      sizeChanger: ChinesePageSizeSelect,
    },
  }
}
