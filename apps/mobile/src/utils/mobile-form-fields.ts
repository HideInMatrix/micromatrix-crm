import {
  computeFieldVisibility,
  mergeAlertFields,
  type FieldVO,
  type ModuleFormProp,
} from '@micromatrix/shared'

/** 与 PC 共用字段和表单级展示组件配置，仅保留移动端显式禁用的字段。 */
export function visibleMobileFormFields(
  fields: FieldVO[],
  formProp: ModuleFormProp | undefined,
  values: Record<string, unknown>,
  fieldFilter?: (field: FieldVO) => boolean,
): FieldVO[] {
  const visibility = computeFieldVisibility(fields, values)
  return mergeAlertFields(fields, formProp).filter(
    (field) =>
      !field.hidden &&
      field.mobile !== false &&
      visibility[field.id] !== false &&
      (fieldFilter?.(field) ?? true),
  )
}
