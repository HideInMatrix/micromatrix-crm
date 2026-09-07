import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModuleFormProp } from '@micromatrix/shared'
import { MetadataService } from './metadata.service'
import type { ModuleFormsService } from './module-forms.service'

test('formProp PATCH 只覆盖提交属性并保留既有 linkProp/扩展键', async () => {
  const original: ModuleFormProp = {
    labelPos: 'top',
    viewSize: 'small',
    linkProp: {
      lead: [{ key: 'CLUE_TO_RECORD', linkFields: [] }],
    },
    futureFlag: { enabled: true },
  }
  let saved: ModuleFormProp | undefined
  const moduleForms = {
    getConfig: async () => ({ formKey: 'followPlan', formProp: original, fields: [] }),
    saveFormProp: async (_tenant: string, _module: string, formProp: ModuleFormProp) => {
      saved = formProp
      return { formKey: 'followPlan', formProp, fields: [] }
    },
  } as unknown as ModuleFormsService

  const service = new MetadataService(moduleForms)
  await service.updateFormProp(
    'tenant-1',
    'followPlan',
    { labelPos: 'left', viewSize: 'large' },
    'user-1',
  )

  assert.deepEqual(saved, {
    ...original,
    labelPos: 'left',
    viewSize: 'large',
  })
})
