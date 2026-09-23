import type { DepartmentVO } from '@micromatrix/shared'

export interface MobileSearchSelectOption {
  id: string
  name: string
  description?: string
}

export function flattenDepartmentOptions(
  nodes: DepartmentVO[],
  parentNames: string[] = [],
): MobileSearchSelectOption[] {
  return nodes.flatMap((node) => {
    const path = [...parentNames, node.name]
    const current: MobileSearchSelectOption = {
      id: node.id,
      name: node.name,
      description: parentNames.length ? parentNames.join(' / ') : undefined,
    }
    return [current, ...flattenDepartmentOptions(node.children ?? [], path)]
  })
}

export function filterSearchSelectOptions(
  options: MobileSearchSelectOption[],
  keyword: string,
) {
  const value = keyword.trim().toLocaleLowerCase()
  if (!value) return options
  return options.filter((option) =>
    [option.name, option.description]
      .filter(Boolean)
      .some((text) => text!.toLocaleLowerCase().includes(value)),
  )
}

