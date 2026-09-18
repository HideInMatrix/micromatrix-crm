export const PRISMA_FIXTURE_MODELS = {
  "tenant": {
    "model": "Tenants",
    "table": "tenants",
    "fields": {
      "id": "id",
      "name": "name",
      "slug": "slug",
      "status": "status",
      "enterpriseSyncResource": "enterpriseSyncResource",
      "enterpriseSynced": "enterpriseSynced",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "users": {
        "prisma": "users",
        "target": "user",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "roles": {
        "prisma": "roles",
        "target": "role",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "userRoles": {
        "prisma": "userRoles",
        "target": "userRole",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "subscriptions": {
        "prisma": "subscriptions",
        "target": "subscription",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "departments": {
        "prisma": "departments",
        "target": "department",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "moduleConfigs": {
        "prisma": "moduleConfigs",
        "target": "moduleConfig",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "topNavigationConfigs": {
        "prisma": "topNavigationConfigs",
        "target": "topNavigationConfig",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "messageTaskSettings": {
        "prisma": "messageTaskSettings",
        "target": "messageTaskSetting",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "enterpriseAiModels": {
        "prisma": "enterpriseAiModels",
        "target": "enterpriseAiModel",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "enterpriseAiRoutes": {
        "prisma": "enterpriseAiModelRoutes",
        "target": "enterpriseAiModelRoute",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "enterpriseTermCategories": {
        "prisma": "enterpriseTermCategories",
        "target": "enterpriseTermCategory",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "enterpriseTerms": {
        "prisma": "enterpriseTerms",
        "target": "enterpriseTerm",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "enterpriseTermDiscoveries": {
        "prisma": "enterpriseTermDiscoveries",
        "target": "enterpriseTermDiscovery",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "enterpriseGlobalTasks": {
        "prisma": "enterpriseGlobalTasks",
        "target": "enterpriseGlobalTask",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "enterpriseTaskExecutions": {
        "prisma": "enterpriseGlobalTaskExecutions",
        "target": "enterpriseGlobalTaskExecution",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "enterpriseIntegrations": {
        "prisma": "enterpriseIntegrations",
        "target": "enterpriseIntegration",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "externalDepartmentMappings": {
        "prisma": "externalDepartmentMappings",
        "target": "externalDepartmentMapping",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "externalUserMappings": {
        "prisma": "externalUserMappings",
        "target": "externalUserMapping",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "externalIdentities": {
        "prisma": "externalIdentities",
        "target": "externalIdentity",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "externalOAuthStates": {
        "prisma": "externalOauthStates",
        "target": "externalOAuthState",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "messageDeliveries": {
        "prisma": "messageDeliveries",
        "target": "messageDelivery",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "organizationSyncBatches": {
        "prisma": "organizationSyncBatches",
        "target": "organizationSyncBatch",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      },
      "operationLogSetting": {
        "prisma": "operationLogSettings",
        "target": "operationLogSetting",
        "cardinality": "1:1",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "tenantId"
        ]
      }
    }
  },
  "department": {
    "model": "Departments",
    "table": "departments",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "name": "name",
      "parentId": "parentId",
      "leaderId": "leaderId",
      "sort": "sort",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "parent": {
        "prisma": "parent",
        "target": "department",
        "cardinality": "N:1",
        "localFields": [
          "parentId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "users": {
        "prisma": "users",
        "target": "user",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "deptId"
        ]
      },
      "externalMappings": {
        "prisma": "externalDepartmentMappings",
        "target": "externalDepartmentMapping",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "departmentId"
        ]
      }
    }
  },
  "user": {
    "model": "Users",
    "table": "users",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "email": "email",
      "passwordHash": "passwordHash",
      "name": "name",
      "status": "status",
      "deptId": "deptId",
      "leaderId": "leaderId",
      "position": "position",
      "phone": "phone",
      "gender": "gender",
      "language": "language",
      "passwordLoginEnabled": "passwordLoginEnabled",
      "defaultPwd": "defaultPwd",
      "authVersion": "authVersion",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "dept": {
        "prisma": "dept",
        "target": "department",
        "cardinality": "N:1",
        "localFields": [
          "deptId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "userRoles": {
        "prisma": "userRoles",
        "target": "userRole",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "userId"
        ]
      },
      "externalMappings": {
        "prisma": "externalUserMappings",
        "target": "externalUserMapping",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "userId"
        ]
      },
      "externalIdentities": {
        "prisma": "externalIdentities",
        "target": "externalIdentity",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "userId"
        ]
      },
      "messageDeliveries": {
        "prisma": "messageDeliveries",
        "target": "messageDelivery",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "userId"
        ]
      },
      "apiKeys": {
        "prisma": "userKeys",
        "target": "userApiKey",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "createUser"
        ]
      },
      "extension": {
        "prisma": "userExtensions",
        "target": "userExtension",
        "cardinality": "1:1",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "userApiKey": {
    "model": "UserKey",
    "table": "user_key",
    "fields": {
      "id": "id",
      "userId": "createUser",
      "accessKey": "accessKey",
      "secretKey": "secretKey",
      "createdAt": "createTime",
      "enabled": "enable",
      "forever": "forever",
      "expireAt": "expireTime",
      "description": "description"
    },
    "relations": {
      "user": {
        "prisma": "users",
        "target": "user",
        "cardinality": "N:1",
        "localFields": [
          "createUser"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "userExtension": {
    "model": "UserExtensions",
    "table": "user_extensions",
    "fields": {
      "id": "id",
      "avatar": "avatar",
      "platformInfo": "platformInfo"
    },
    "relations": {
      "user": {
        "prisma": "users",
        "target": "user",
        "cardinality": "N:1",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "role": {
    "model": "Roles",
    "table": "roles",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "name": "name",
      "permissions": "permissions",
      "dataScope": "dataScope",
      "scopeDeptIds": "scopeDeptIds",
      "isSystem": "isSystem",
      "remark": "remark",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "userRoles": {
        "prisma": "userRoles",
        "target": "userRole",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "roleId"
        ]
      },
      "defaultForEnterpriseIntegrations": {
        "prisma": "enterpriseIntegrations",
        "target": "enterpriseIntegration",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "syncDefaultRoleId"
        ]
      }
    }
  },
  "userRole": {
    "model": "UserRoles",
    "table": "user_roles",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "userId": "userId",
      "roleId": "roleId",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "user": {
        "prisma": "user",
        "target": "user",
        "cardinality": "N:1",
        "localFields": [
          "userId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "role": {
        "prisma": "role",
        "target": "role",
        "cardinality": "N:1",
        "localFields": [
          "roleId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "customer": {
    "model": "Customer",
    "table": "customer",
    "fields": {
      "id": "id",
      "name": "name",
      "owner": "owner",
      "collectionTime": "collectionTime",
      "poolId": "poolId",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser",
      "inSharedPool": "inSharedPool",
      "organizationId": "organizationId",
      "follower": "follower",
      "followTime": "followTime",
      "reasonId": "reasonId"
    },
    "relations": {
      "pool": {
        "prisma": "pool",
        "target": "customerPool",
        "cardinality": "N:1",
        "localFields": [
          "poolId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "fieldValues": {
        "prisma": "customerFields",
        "target": "customerField",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "fieldBlobValues": {
        "prisma": "customerFieldBlobs",
        "target": "customerFieldBlob",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "ownerHistory": {
        "prisma": "customerOwners",
        "target": "customerOwner",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "customerId"
        ]
      },
      "contacts": {
        "prisma": "customerContacts",
        "target": "customerContact",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "customerId"
        ]
      },
      "collaborations": {
        "prisma": "customerCollaborations",
        "target": "customerCollaboration",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "customerId"
        ]
      },
      "opportunities": {
        "prisma": "opportunities",
        "target": "opportunity",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "customerId"
        ]
      },
      "contracts": {
        "prisma": "contracts",
        "target": "contract",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "customerId"
        ]
      },
      "orders": {
        "prisma": "salesOrders",
        "target": "order",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "customerId"
        ]
      }
    }
  },
  "customerField": {
    "model": "CustomerField",
    "table": "customer_field",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "customer",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "customerFieldBlob": {
    "model": "CustomerFieldBlob",
    "table": "customer_field_blob",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "customer",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "customerOwner": {
    "model": "CustomerOwner",
    "table": "customer_owner",
    "fields": {
      "id": "id",
      "customerId": "customerId",
      "owner": "owner",
      "collectionTime": "collectionTime",
      "endTime": "endTime",
      "operator": "operator",
      "reasonId": "reasonId"
    },
    "relations": {
      "customer": {
        "prisma": "customer",
        "target": "customer",
        "cardinality": "N:1",
        "localFields": [
          "customerId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "customerContact": {
    "model": "CustomerContact",
    "table": "customer_contact",
    "fields": {
      "id": "id",
      "customerId": "customerId",
      "name": "name",
      "phone": "phone",
      "owner": "owner",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser",
      "enable": "enable",
      "disableReason": "disableReason",
      "organizationId": "organizationId"
    },
    "relations": {
      "customer": {
        "prisma": "customer",
        "target": "customer",
        "cardinality": "N:1",
        "localFields": [
          "customerId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "fieldValues": {
        "prisma": "customerContactFields",
        "target": "customerContactField",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "fieldBlobValues": {
        "prisma": "customerContactFieldBlobs",
        "target": "customerContactFieldBlob",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "opportunities": {
        "prisma": "opportunities",
        "target": "opportunity",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "contactId"
        ]
      }
    }
  },
  "customerContactField": {
    "model": "CustomerContactField",
    "table": "customer_contact_field",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "customerContact",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "customerContactFieldBlob": {
    "model": "CustomerContactFieldBlob",
    "table": "customer_contact_field_blob",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "customerContact",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "customerCollaboration": {
    "model": "CustomerCollaboration",
    "table": "customer_collaboration",
    "fields": {
      "id": "id",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser",
      "userId": "userId",
      "customerId": "customerId",
      "collaborationType": "collaborationType"
    },
    "relations": {
      "customer": {
        "prisma": "customer",
        "target": "customer",
        "cardinality": "N:1",
        "localFields": [
          "customerId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "customerRelation": {
    "model": "CustomerRelation",
    "table": "customer_relation",
    "fields": {
      "id": "id",
      "sourceCustomerId": "sourceCustomerId",
      "targetCustomerId": "targetCustomerId",
      "createTime": "createTime"
    },
    "relations": {
      "sourceCustomer": {
        "prisma": "sourceCustomer",
        "target": "customer",
        "cardinality": "N:1",
        "localFields": [
          "sourceCustomerId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "targetCustomer": {
        "prisma": "targetCustomer",
        "target": "customer",
        "cardinality": "N:1",
        "localFields": [
          "targetCustomerId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "customerPool": {
    "model": "CustomerPool",
    "table": "customer_pool",
    "fields": {
      "id": "id",
      "scopeId": "scopeId",
      "organizationId": "organizationId",
      "name": "name",
      "ownerId": "ownerId",
      "enable": "enable",
      "auto": "auto",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "customers": {
        "prisma": "customers",
        "target": "customer",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "poolId"
        ]
      },
      "hiddenFields": {
        "prisma": "customerPoolHiddenFields",
        "target": "customerPoolHiddenField",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "poolId"
        ]
      }
    }
  },
  "customerPoolHiddenField": {
    "model": "CustomerPoolHiddenField",
    "table": "customer_pool_hidden_field",
    "fields": {
      "poolId": "poolId",
      "fieldId": "fieldId"
    },
    "relations": {
      "pool": {
        "prisma": "pool",
        "target": "customerPool",
        "cardinality": "N:1",
        "localFields": [
          "poolId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "customerPoolPickRule": {
    "model": "CustomerPoolPickRule",
    "table": "customer_pool_pick_rule",
    "fields": {
      "id": "id",
      "poolId": "poolId",
      "limitOnNumber": "limitOnNumber",
      "pickNumber": "pickNumber",
      "limitPreOwner": "limitPreOwner",
      "pickIntervalDays": "pickIntervalDays",
      "limitNew": "limitNew",
      "newPickInterval": "newPickInterval",
      "createUser": "createUser",
      "createTime": "createTime",
      "updateUser": "updateUser",
      "updateTime": "updateTime"
    },
    "relations": {
      "pool": {
        "prisma": "pool",
        "target": "customerPool",
        "cardinality": "N:1",
        "localFields": [
          "poolId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "customerPoolRecycleRule": {
    "model": "CustomerPoolRecycleRule",
    "table": "customer_pool_recycle_rule",
    "fields": {
      "id": "id",
      "poolId": "poolId",
      "operator": "operator",
      "condition": "condition",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "pool": {
        "prisma": "pool",
        "target": "customerPool",
        "cardinality": "N:1",
        "localFields": [
          "poolId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "customerCapacity": {
    "model": "CustomerCapacity",
    "table": "customer_capacity",
    "fields": {
      "id": "id",
      "organizationId": "organizationId",
      "scopeId": "scopeId",
      "capacity": "capacity",
      "filter": "filter",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {}
  },
  "clue": {
    "model": "Clue",
    "table": "clue",
    "fields": {
      "id": "id",
      "name": "name",
      "owner": "owner",
      "lastStage": "lastStage",
      "stage": "stage",
      "collectionTime": "collectionTime",
      "contact": "contact",
      "phone": "phone",
      "products": "products",
      "organizationId": "organizationId",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser",
      "transitionType": "transitionType",
      "transitionId": "transitionId",
      "inSharedPool": "inSharedPool",
      "follower": "follower",
      "followTime": "followTime",
      "poolId": "poolId",
      "reasonId": "reasonId"
    },
    "relations": {
      "pool": {
        "prisma": "pool",
        "target": "cluePool",
        "cardinality": "N:1",
        "localFields": [
          "poolId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "fieldValues": {
        "prisma": "clueFields",
        "target": "clueField",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "fieldBlobValues": {
        "prisma": "clueFieldBlobs",
        "target": "clueFieldBlob",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "ownerHistory": {
        "prisma": "clueOwners",
        "target": "clueOwner",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "clueId"
        ]
      }
    }
  },
  "clueField": {
    "model": "ClueField",
    "table": "clue_field",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "clue",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "clueFieldBlob": {
    "model": "ClueFieldBlob",
    "table": "clue_field_blob",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "clue",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "clueOwner": {
    "model": "ClueOwner",
    "table": "clue_owner",
    "fields": {
      "id": "id",
      "clueId": "clueId",
      "owner": "owner",
      "collectionTime": "collectionTime",
      "endTime": "endTime",
      "operator": "operator",
      "reasonId": "reasonId"
    },
    "relations": {
      "clue": {
        "prisma": "clue",
        "target": "clue",
        "cardinality": "N:1",
        "localFields": [
          "clueId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "cluePool": {
    "model": "CluePool",
    "table": "clue_pool",
    "fields": {
      "id": "id",
      "name": "name",
      "scopeId": "scopeId",
      "organizationId": "organizationId",
      "ownerId": "ownerId",
      "enable": "enable",
      "auto": "auto",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "clues": {
        "prisma": "clues",
        "target": "clue",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "poolId"
        ]
      },
      "hiddenFields": {
        "prisma": "cluePoolHiddenFields",
        "target": "cluePoolHiddenField",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "poolId"
        ]
      }
    }
  },
  "cluePoolHiddenField": {
    "model": "CluePoolHiddenField",
    "table": "clue_pool_hidden_field",
    "fields": {
      "poolId": "poolId",
      "fieldId": "fieldId"
    },
    "relations": {
      "pool": {
        "prisma": "pool",
        "target": "cluePool",
        "cardinality": "N:1",
        "localFields": [
          "poolId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "cluePoolPickRule": {
    "model": "CluePoolPickRule",
    "table": "clue_pool_pick_rule",
    "fields": {
      "id": "id",
      "poolId": "poolId",
      "limitOnNumber": "limitOnNumber",
      "pickNumber": "pickNumber",
      "limitPreOwner": "limitPreOwner",
      "pickIntervalDays": "pickIntervalDays",
      "limitNew": "limitNew",
      "newPickInterval": "newPickInterval",
      "createUser": "createUser",
      "createTime": "createTime",
      "updateUser": "updateUser",
      "updateTime": "updateTime"
    },
    "relations": {
      "pool": {
        "prisma": "pool",
        "target": "cluePool",
        "cardinality": "N:1",
        "localFields": [
          "poolId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "cluePoolRecycleRule": {
    "model": "CluePoolRecycleRule",
    "table": "clue_pool_recycle_rule",
    "fields": {
      "id": "id",
      "poolId": "poolId",
      "operator": "operator",
      "condition": "condition",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "pool": {
        "prisma": "pool",
        "target": "cluePool",
        "cardinality": "N:1",
        "localFields": [
          "poolId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "clueCapacity": {
    "model": "ClueCapacity",
    "table": "clue_capacity",
    "fields": {
      "id": "id",
      "organizationId": "organizationId",
      "scopeId": "scopeId",
      "capacity": "capacity",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {}
  },
  "sysDict": {
    "model": "SysDict",
    "table": "sys_dict",
    "fields": {
      "id": "id",
      "name": "name",
      "module": "module",
      "type": "_type",
      "pos": "pos",
      "organizationId": "organizationId",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {}
  },
  "sysDictConfig": {
    "model": "SysDictConfig",
    "table": "sys_dict_config",
    "fields": {
      "module": "module",
      "organizationId": "organizationId",
      "enabled": "enabled"
    },
    "relations": {}
  },
  "followUpRecord": {
    "model": "FollowUpRecords",
    "table": "follow_up_records",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "targetType": "targetType",
      "targetId": "targetId",
      "contactId": "contactId",
      "type": "_type",
      "content": "content",
      "followedAt": "followedAt",
      "ownerId": "ownerId",
      "ownerName": "ownerName",
      "deptId": "deptId",
      "createdById": "createdById",
      "commentCount": "commentCount",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "fields": {
        "prisma": "followUpRecordFields",
        "target": "followUpRecordField",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "fieldBlobs": {
        "prisma": "followUpRecordFieldBlobs",
        "target": "followUpRecordFieldBlob",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "comments": {
        "prisma": "followUpRecordComments",
        "target": "followUpRecordComment",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      }
    }
  },
  "followUpRecordField": {
    "model": "FollowUpRecordField",
    "table": "follow_up_record_field",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "followUpRecord",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "followUpRecordFieldBlob": {
    "model": "FollowUpRecordFieldBlob",
    "table": "follow_up_record_field_blob",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "followUpRecord",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "followUpRecordComment": {
    "model": "FollowUpRecordComment",
    "table": "follow_up_record_comment",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "parentId": "parentId",
      "replyToUserId": "replyToUserId",
      "content": "content",
      "tenantId": "organizationId",
      "createdById": "createUser",
      "updatedById": "updateUser",
      "createdAt": "createTime",
      "updatedAt": "updateTime"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "followUpRecord",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "parent": {
        "prisma": "parent",
        "target": "followUpRecordComment",
        "cardinality": "N:1",
        "localFields": [
          "parentId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "mentions": {
        "prisma": "followUpRecordCommentMentions",
        "target": "followUpRecordCommentMention",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "commentId"
        ]
      }
    }
  },
  "followUpRecordCommentMention": {
    "model": "FollowUpRecordCommentMention",
    "table": "follow_up_record_comment_mention",
    "fields": {
      "id": "id",
      "commentId": "commentId",
      "userId": "userId"
    },
    "relations": {
      "comment": {
        "prisma": "comment",
        "target": "followUpRecordComment",
        "cardinality": "N:1",
        "localFields": [
          "commentId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "followUpPlan": {
    "model": "FollowUpPlans",
    "table": "follow_up_plans",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "targetType": "targetType",
      "targetId": "targetId",
      "contactId": "contactId",
      "content": "content",
      "method": "method",
      "estimatedAt": "estimatedAt",
      "status": "status",
      "converted": "converted",
      "convertedRecordId": "convertedRecordId",
      "ownerId": "ownerId",
      "deptId": "deptId",
      "createdById": "createdById",
      "dueNotifiedAt": "dueNotifiedAt",
      "commentCount": "commentCount",
      "customData": "customData",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "fields": {
        "prisma": "followUpPlanFields",
        "target": "followUpPlanField",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "fieldBlobs": {
        "prisma": "followUpPlanFieldBlobs",
        "target": "followUpPlanFieldBlob",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "comments": {
        "prisma": "followUpPlanComments",
        "target": "followUpPlanComment",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      }
    }
  },
  "followUpPlanField": {
    "model": "FollowUpPlanField",
    "table": "follow_up_plan_field",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "followUpPlan",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "followUpPlanFieldBlob": {
    "model": "FollowUpPlanFieldBlob",
    "table": "follow_up_plan_field_blob",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "followUpPlan",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "followUpPlanComment": {
    "model": "FollowUpPlanComment",
    "table": "follow_up_plan_comment",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "parentId": "parentId",
      "replyToUserId": "replyToUserId",
      "content": "content",
      "tenantId": "organizationId",
      "createdById": "createUser",
      "updatedById": "updateUser",
      "createdAt": "createTime",
      "updatedAt": "updateTime"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "followUpPlan",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "parent": {
        "prisma": "parent",
        "target": "followUpPlanComment",
        "cardinality": "N:1",
        "localFields": [
          "parentId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "mentions": {
        "prisma": "followUpPlanCommentMentions",
        "target": "followUpPlanCommentMention",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "commentId"
        ]
      }
    }
  },
  "followUpPlanCommentMention": {
    "model": "FollowUpPlanCommentMention",
    "table": "follow_up_plan_comment_mention",
    "fields": {
      "id": "id",
      "commentId": "commentId",
      "userId": "userId"
    },
    "relations": {
      "comment": {
        "prisma": "comment",
        "target": "followUpPlanComment",
        "cardinality": "N:1",
        "localFields": [
          "commentId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "opportunityStageConfig": {
    "model": "OpportunityStageConfig",
    "table": "opportunity_stage_config",
    "fields": {
      "id": "id",
      "name": "name",
      "type": "_type",
      "rate": "rate",
      "afootRollBack": "afootRollBack",
      "endRollBack": "endRollBack",
      "pos": "pos",
      "organizationId": "organizationId",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "opportunities": {
        "prisma": "opportunities",
        "target": "opportunity",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "stage"
        ]
      }
    }
  },
  "opportunity": {
    "model": "Opportunity",
    "table": "opportunity",
    "fields": {
      "id": "id",
      "customerId": "customerId",
      "name": "name",
      "amount": "amount",
      "possible": "possible",
      "products": "products",
      "organizationId": "organizationId",
      "lastStage": "lastStage",
      "stage": "stage",
      "contactId": "contactId",
      "owner": "owner",
      "updateUser": "updateUser",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "follower": "follower",
      "followTime": "followTime",
      "expectedEndTime": "expectedEndTime",
      "actualEndTime": "actualEndTime",
      "failureReason": "failureReason",
      "pos": "pos"
    },
    "relations": {
      "customer": {
        "prisma": "customer",
        "target": "customer",
        "cardinality": "N:1",
        "localFields": [
          "customerId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "contact": {
        "prisma": "contact",
        "target": "customerContact",
        "cardinality": "N:1",
        "localFields": [
          "contactId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "stageConfig": {
        "prisma": "opportunityStageConfig",
        "target": "opportunityStageConfig",
        "cardinality": "N:1",
        "localFields": [
          "stage"
        ],
        "targetFields": [
          "id"
        ]
      },
      "fieldValues": {
        "prisma": "opportunityFields",
        "target": "opportunityField",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "fieldBlobValues": {
        "prisma": "opportunityFieldBlobs",
        "target": "opportunityFieldBlob",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "quotations": {
        "prisma": "opportunityQuotations",
        "target": "opportunityQuotation",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "opportunityId"
        ]
      }
    }
  },
  "opportunityField": {
    "model": "OpportunityField",
    "table": "opportunity_field",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "opportunity",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "opportunityFieldBlob": {
    "model": "OpportunityFieldBlob",
    "table": "opportunity_field_blob",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "opportunity",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "opportunityRule": {
    "model": "OpportunityRule",
    "table": "opportunity_rule",
    "fields": {
      "id": "id",
      "name": "name",
      "organizationId": "organizationId",
      "ownerId": "ownerId",
      "scopeId": "scopeId",
      "enable": "enable",
      "auto": "auto",
      "operator": "operator",
      "condition": "condition",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {}
  },
  "product": {
    "model": "Product",
    "table": "product",
    "fields": {
      "id": "id",
      "name": "name",
      "price": "price",
      "status": "status",
      "pos": "pos",
      "organizationId": "organizationId",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "fieldValues": {
        "prisma": "productFields",
        "target": "productField",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "fieldBlobValues": {
        "prisma": "productFieldBlobs",
        "target": "productFieldBlob",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      }
    }
  },
  "productField": {
    "model": "ProductField",
    "table": "product_field",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "product",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "productFieldBlob": {
    "model": "ProductFieldBlob",
    "table": "product_field_blob",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "product",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "productPrice": {
    "model": "ProductPrice",
    "table": "product_price",
    "fields": {
      "id": "id",
      "name": "name",
      "status": "status",
      "pos": "pos",
      "organizationId": "organizationId",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "fieldValues": {
        "prisma": "productPriceFields",
        "target": "productPriceField",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "fieldBlobValues": {
        "prisma": "productPriceFieldBlobs",
        "target": "productPriceFieldBlob",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      }
    }
  },
  "productPriceField": {
    "model": "ProductPriceField",
    "table": "product_price_field",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue",
      "refSubId": "refSubId",
      "rowId": "rowId",
      "bizId": "bizId"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "productPrice",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "productPriceFieldBlob": {
    "model": "ProductPriceFieldBlob",
    "table": "product_price_field_blob",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue",
      "refSubId": "refSubId",
      "rowId": "rowId",
      "bizId": "bizId"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "productPrice",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "opportunityQuotation": {
    "model": "OpportunityQuotation",
    "table": "opportunity_quotation",
    "fields": {
      "id": "id",
      "name": "name",
      "opportunityId": "opportunityId",
      "untilTime": "untilTime",
      "amount": "amount",
      "approvalStatus": "approvalStatus",
      "invalid": "invalid",
      "organizationId": "organizationId",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser",
      "approved": "approved"
    },
    "relations": {
      "opportunity": {
        "prisma": "opportunity",
        "target": "opportunity",
        "cardinality": "N:1",
        "localFields": [
          "opportunityId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "fieldValues": {
        "prisma": "opportunityQuotationFields",
        "target": "opportunityQuotationField",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "fieldBlobValues": {
        "prisma": "opportunityQuotationFieldBlobs",
        "target": "opportunityQuotationFieldBlob",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "snapshots": {
        "prisma": "opportunityQuotationSnapshots",
        "target": "opportunityQuotationSnapshot",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "quotationId"
        ]
      }
    }
  },
  "opportunityQuotationField": {
    "model": "OpportunityQuotationField",
    "table": "opportunity_quotation_field",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue",
      "refSubId": "refSubId",
      "rowId": "rowId",
      "bizId": "bizId"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "opportunityQuotation",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "opportunityQuotationFieldBlob": {
    "model": "OpportunityQuotationFieldBlob",
    "table": "opportunity_quotation_field_blob",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue",
      "refSubId": "refSubId",
      "rowId": "rowId",
      "bizId": "bizId"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "opportunityQuotation",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "opportunityQuotationSnapshot": {
    "model": "OpportunityQuotationSnapshot",
    "table": "opportunity_quotation_snapshot",
    "fields": {
      "id": "id",
      "quotationId": "quotationId",
      "quotationProp": "quotationProp",
      "quotationValue": "quotationValue"
    },
    "relations": {
      "quotation": {
        "prisma": "quotation",
        "target": "opportunityQuotation",
        "cardinality": "N:1",
        "localFields": [
          "quotationId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "contract": {
    "model": "Contract",
    "table": "contract",
    "fields": {
      "id": "id",
      "name": "name",
      "customerId": "customerId",
      "owner": "owner",
      "amount": "amount",
      "number": "number",
      "approvalStatus": "approvalStatus",
      "stage": "stage",
      "startTime": "startTime",
      "endTime": "endTime",
      "voidReason": "voidReason",
      "organizationId": "organizationId",
      "pos": "pos",
      "approved": "approved",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "customer": {
        "prisma": "customer",
        "target": "customer",
        "cardinality": "N:1",
        "localFields": [
          "customerId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "fieldValues": {
        "prisma": "contractFields",
        "target": "contractField",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "fieldBlobValues": {
        "prisma": "contractFieldBlobs",
        "target": "contractFieldBlob",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "snapshots": {
        "prisma": "contractSnapshots",
        "target": "contractSnapshot",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "contractId"
        ]
      },
      "paymentPlans": {
        "prisma": "contractPaymentPlans",
        "target": "contractPaymentPlan",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "contractId"
        ]
      },
      "paymentRecords": {
        "prisma": "contractPaymentRecords",
        "target": "contractPaymentRecord",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "contractId"
        ]
      },
      "contractInvoices": {
        "prisma": "contractInvoices",
        "target": "contractInvoice",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "contractId"
        ]
      },
      "orders": {
        "prisma": "salesOrders",
        "target": "order",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "contractId"
        ]
      }
    }
  },
  "contractField": {
    "model": "ContractField",
    "table": "contract_field",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue",
      "refSubId": "refSubId",
      "rowId": "rowId",
      "bizId": "bizId"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "contract",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "contractFieldBlob": {
    "model": "ContractFieldBlob",
    "table": "contract_field_blob",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue",
      "refSubId": "refSubId",
      "rowId": "rowId",
      "bizId": "bizId"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "contract",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "contractSnapshot": {
    "model": "ContractSnapshot",
    "table": "contract_snapshot",
    "fields": {
      "id": "id",
      "contractId": "contractId",
      "contractProp": "contractProp",
      "contractValue": "contractValue"
    },
    "relations": {
      "contract": {
        "prisma": "contract",
        "target": "contract",
        "cardinality": "N:1",
        "localFields": [
          "contractId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "contractStageConfig": {
    "model": "ContractStageConfig",
    "table": "contract_stage_config",
    "fields": {
      "id": "id",
      "name": "name",
      "type": "_type",
      "afootRollBack": "afootRollBack",
      "endRollBack": "endRollBack",
      "pos": "pos",
      "organizationId": "organizationId",
      "circulationType": "circulationType",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {}
  },
  "stageAdvancedConfig": {
    "model": "StageAdvancedConfig",
    "table": "stage_advanced_config",
    "fields": {
      "id": "id",
      "originId": "originId",
      "targetId": "targetId",
      "enable": "enable",
      "fieldConfig": "fieldConfig",
      "moduleType": "moduleType",
      "organizationId": "organizationId",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {}
  },
  "contractPaymentPlan": {
    "model": "ContractPaymentPlan",
    "table": "contract_payment_plan",
    "fields": {
      "id": "id",
      "name": "name",
      "contractId": "contractId",
      "owner": "owner",
      "planStatus": "planStatus",
      "planAmount": "planAmount",
      "planEndTime": "planEndTime",
      "organizationId": "organizationId",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "contract": {
        "prisma": "contract",
        "target": "contract",
        "cardinality": "N:1",
        "localFields": [
          "contractId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "paymentRecords": {
        "prisma": "contractPaymentRecords",
        "target": "contractPaymentRecord",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "paymentPlanId"
        ]
      },
      "fieldValues": {
        "prisma": "contractPaymentPlanFields",
        "target": "contractPaymentPlanField",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "fieldBlobValues": {
        "prisma": "contractPaymentPlanFieldBlobs",
        "target": "contractPaymentPlanFieldBlob",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      }
    }
  },
  "contractPaymentPlanField": {
    "model": "ContractPaymentPlanField",
    "table": "contract_payment_plan_field",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "contractPaymentPlan",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "contractPaymentPlanFieldBlob": {
    "model": "ContractPaymentPlanFieldBlob",
    "table": "contract_payment_plan_field_blob",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "contractPaymentPlan",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "contractPaymentRecord": {
    "model": "ContractPaymentRecord",
    "table": "contract_payment_record",
    "fields": {
      "id": "id",
      "name": "name",
      "no": "no",
      "owner": "owner",
      "contractId": "contractId",
      "paymentPlanId": "paymentPlanId",
      "recordAmount": "recordAmount",
      "recordEndTime": "recordEndTime",
      "organizationId": "organizationId",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "contract": {
        "prisma": "contract",
        "target": "contract",
        "cardinality": "N:1",
        "localFields": [
          "contractId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "paymentPlan": {
        "prisma": "paymentPlan",
        "target": "contractPaymentPlan",
        "cardinality": "N:1",
        "localFields": [
          "paymentPlanId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "fieldValues": {
        "prisma": "contractPaymentRecordFields",
        "target": "contractPaymentRecordField",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "fieldBlobValues": {
        "prisma": "contractPaymentRecordFieldBlobs",
        "target": "contractPaymentRecordFieldBlob",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      }
    }
  },
  "contractPaymentRecordField": {
    "model": "ContractPaymentRecordField",
    "table": "contract_payment_record_field",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "contractPaymentRecord",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "contractPaymentRecordFieldBlob": {
    "model": "ContractPaymentRecordFieldBlob",
    "table": "contract_payment_record_field_blob",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "contractPaymentRecord",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "businessTitle": {
    "model": "BusinessTitle",
    "table": "business_title",
    "fields": {
      "id": "id",
      "name": "name",
      "type": "_type",
      "identificationNumber": "identificationNumber",
      "openingBank": "openingBank",
      "bankAccount": "bankAccount",
      "registrationAddress": "registrationAddress",
      "phoneNumber": "phoneNumber",
      "registeredCapital": "registeredCapital",
      "companySize": "companySize",
      "registrationNumber": "registrationNumber",
      "approvalStatus": "approvalStatus",
      "unapprovedReason": "unapprovedReason",
      "organizationId": "organizationId",
      "province": "province",
      "city": "city",
      "scale": "scale",
      "industry": "industry",
      "remark": "remark",
      "companyNumber": "companyNumber",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "contractInvoices": {
        "prisma": "contractInvoices",
        "target": "contractInvoice",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "businessTitleId"
        ]
      }
    }
  },
  "businessTitleConfig": {
    "model": "BusinessTitleConfig",
    "table": "business_title_config",
    "fields": {
      "id": "id",
      "field": "field",
      "required": "required",
      "organizationId": "organizationId"
    },
    "relations": {}
  },
  "contractInvoice": {
    "model": "ContractInvoice",
    "table": "contract_invoice",
    "fields": {
      "id": "id",
      "name": "name",
      "contractId": "contractId",
      "owner": "owner",
      "amount": "amount",
      "invoiceType": "invoiceType",
      "taxRate": "taxRate",
      "approvalStatus": "approvalStatus",
      "businessTitleId": "businessTitleId",
      "organizationId": "organizationId",
      "approved": "approved",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "contract": {
        "prisma": "contract",
        "target": "contract",
        "cardinality": "N:1",
        "localFields": [
          "contractId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "businessTitle": {
        "prisma": "businessTitle",
        "target": "businessTitle",
        "cardinality": "N:1",
        "localFields": [
          "businessTitleId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "fieldValues": {
        "prisma": "contractInvoiceFields",
        "target": "contractInvoiceField",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "fieldBlobValues": {
        "prisma": "contractInvoiceFieldBlobs",
        "target": "contractInvoiceFieldBlob",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "snapshots": {
        "prisma": "contractInvoiceSnapshots",
        "target": "contractInvoiceSnapshot",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "invoiceId"
        ]
      }
    }
  },
  "contractInvoiceField": {
    "model": "ContractInvoiceField",
    "table": "contract_invoice_field",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "contractInvoice",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "contractInvoiceFieldBlob": {
    "model": "ContractInvoiceFieldBlob",
    "table": "contract_invoice_field_blob",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "contractInvoice",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "contractInvoiceSnapshot": {
    "model": "ContractInvoiceSnapshot",
    "table": "contract_invoice_snapshot",
    "fields": {
      "id": "id",
      "invoiceId": "invoiceId",
      "invoiceProp": "invoiceProp",
      "invoiceValue": "invoiceValue"
    },
    "relations": {
      "invoice": {
        "prisma": "invoice",
        "target": "contractInvoice",
        "cardinality": "N:1",
        "localFields": [
          "invoiceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "order": {
    "model": "SalesOrder",
    "table": "sales_order",
    "fields": {
      "id": "id",
      "number": "number",
      "name": "name",
      "customerId": "customerId",
      "contractId": "contractId",
      "owner": "owner",
      "amount": "amount",
      "stage": "stage",
      "approvalStatus": "approvalStatus",
      "organizationId": "organizationId",
      "pos": "pos",
      "approved": "approved",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "customer": {
        "prisma": "customer",
        "target": "customer",
        "cardinality": "N:1",
        "localFields": [
          "customerId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "contract": {
        "prisma": "contract",
        "target": "contract",
        "cardinality": "N:1",
        "localFields": [
          "contractId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "fieldValues": {
        "prisma": "salesOrderFields",
        "target": "orderField",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "fieldBlobValues": {
        "prisma": "salesOrderFieldBlobs",
        "target": "orderFieldBlob",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "snapshots": {
        "prisma": "salesOrderSnapshots",
        "target": "orderSnapshot",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "orderId"
        ]
      }
    }
  },
  "orderField": {
    "model": "SalesOrderField",
    "table": "sales_order_field",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue",
      "refSubId": "refSubId",
      "rowId": "rowId",
      "bizId": "bizId"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "order",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "orderFieldBlob": {
    "model": "SalesOrderFieldBlob",
    "table": "sales_order_field_blob",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue",
      "refSubId": "refSubId",
      "rowId": "rowId",
      "bizId": "bizId"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "order",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "orderSnapshot": {
    "model": "SalesOrderSnapshot",
    "table": "sales_order_snapshot",
    "fields": {
      "id": "id",
      "orderId": "orderId",
      "orderProp": "orderProp",
      "orderValue": "orderValue"
    },
    "relations": {
      "order": {
        "prisma": "order",
        "target": "order",
        "cardinality": "N:1",
        "localFields": [
          "orderId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "orderStageConfig": {
    "model": "SalesOrderStageConfig",
    "table": "sales_order_stage_config",
    "fields": {
      "id": "id",
      "name": "name",
      "type": "_type",
      "afootRollBack": "afootRollBack",
      "endRollBack": "endRollBack",
      "pos": "pos",
      "organizationId": "organizationId",
      "circulationType": "circulationType",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {}
  },
  "approvalFlow": {
    "model": "ApprovalFlows",
    "table": "approval_flows",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "number": "number",
      "formType": "formType",
      "currentVersionId": "currentVersionId",
      "name": "name",
      "createExecute": "createExecute",
      "updateExecute": "updateExecute",
      "deleteExecute": "deleteExecute",
      "submitterCanRevoke": "submitterCanRevoke",
      "allowBatchProcess": "allowBatchProcess",
      "allowWithdraw": "allowWithdraw",
      "allowAddSign": "allowAddSign",
      "duplicateApproverRule": "duplicateApproverRule",
      "requireComment": "requireComment",
      "enabled": "enabled",
      "description": "description",
      "condition": "condition",
      "deletedAt": "deletedAt",
      "createdById": "createdById",
      "updatedById": "updatedById",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "currentVersion": {
        "prisma": "currentVersion",
        "target": "approvalFlowVersion",
        "cardinality": "N:1",
        "localFields": [
          "currentVersionId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "instances": {
        "prisma": "approvalInstances",
        "target": "approvalInstance",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "flowId"
        ]
      }
    }
  },
  "approvalFlowNumberCounter": {
    "model": "ApprovalFlowNumberCounters",
    "table": "approval_flow_number_counters",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "formType": "formType",
      "nextValue": "nextValue",
      "updatedAt": "updatedAt"
    },
    "relations": {}
  },
  "approvalFlowVersion": {
    "model": "ApprovalFlowVersions",
    "table": "approval_flow_versions",
    "fields": {
      "id": "id",
      "flowId": "flowId",
      "tenantId": "tenantId",
      "version": "version",
      "createdById": "createdById",
      "createdAt": "createdAt"
    },
    "relations": {
      "flow": {
        "prisma": "flow",
        "target": "approvalFlow",
        "cardinality": "N:1",
        "localFields": [
          "flowId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "nodes": {
        "prisma": "approvalNodes",
        "target": "approvalNode",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "flowVersionId"
        ]
      },
      "links": {
        "prisma": "approvalNodeLinks",
        "target": "approvalNodeLink",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "flowVersionId"
        ]
      },
      "conditions": {
        "prisma": "approvalNodeConditions",
        "target": "approvalNodeCondition",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "flowVersionId"
        ]
      },
      "instances": {
        "prisma": "approvalInstances",
        "target": "approvalInstance",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "flowVersionId"
        ]
      }
    }
  },
  "approvalNode": {
    "model": "ApprovalNodes",
    "table": "approval_nodes",
    "fields": {
      "id": "id",
      "flowVersionId": "flowVersionId",
      "number": "number",
      "name": "name",
      "nodeType": "nodeType",
      "executeTiming": "executeTiming",
      "sort": "sort"
    },
    "relations": {
      "flowVersion": {
        "prisma": "flowVersion",
        "target": "approvalFlowVersion",
        "cardinality": "N:1",
        "localFields": [
          "flowVersionId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "condition": {
        "prisma": "approvalNodeConditions",
        "target": "approvalNodeCondition",
        "cardinality": "1:1",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "approvalNodeApprover": {
    "model": "ApprovalNodeApprovers",
    "table": "approval_node_approvers",
    "fields": {
      "id": "id",
      "nodeId": "nodeId",
      "approverType": "approverType",
      "approverIds": "approverIds",
      "ccUserIds": "ccUserIds",
      "mode": "mode",
      "emptyApproverAction": "emptyApproverAction",
      "fallbackApprover": "fallbackApprover",
      "sameSubmitterAction": "sameSubmitterAction",
      "approverDirection": "approverDirection",
      "fieldPermissions": "fieldPermissions",
      "passPostConfig": "passPostConfig",
      "rejectPostConfig": "rejectPostConfig"
    },
    "relations": {
      "node": {
        "prisma": "node",
        "target": "approvalNode",
        "cardinality": "N:1",
        "localFields": [
          "nodeId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "approvalNodeCondition": {
    "model": "ApprovalNodeConditions",
    "table": "approval_node_conditions",
    "fields": {
      "id": "id",
      "flowVersionId": "flowVersionId",
      "conditionConfig": "conditionConfig"
    },
    "relations": {
      "node": {
        "prisma": "approvalNodes",
        "target": "approvalNode",
        "cardinality": "N:1",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "id"
        ]
      },
      "flowVersion": {
        "prisma": "flowVersion",
        "target": "approvalFlowVersion",
        "cardinality": "N:1",
        "localFields": [
          "flowVersionId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "approvalNodeLink": {
    "model": "ApprovalNodeLinks",
    "table": "approval_node_links",
    "fields": {
      "id": "id",
      "flowVersionId": "flowVersionId",
      "fromNodeId": "fromNodeId",
      "toNodeId": "toNodeId",
      "sort": "sort"
    },
    "relations": {
      "flowVersion": {
        "prisma": "flowVersion",
        "target": "approvalFlowVersion",
        "cardinality": "N:1",
        "localFields": [
          "flowVersionId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "fromNode": {
        "prisma": "fromNode",
        "target": "approvalNode",
        "cardinality": "N:1",
        "localFields": [
          "fromNodeId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "toNode": {
        "prisma": "toNode",
        "target": "approvalNode",
        "cardinality": "N:1",
        "localFields": [
          "toNodeId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "approvalInstance": {
    "model": "ApprovalInstances",
    "table": "approval_instances",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "flowId": "flowId",
      "flowVersionId": "flowVersionId",
      "executeTiming": "executeTiming",
      "module": "module",
      "targetId": "targetId",
      "targetName": "targetName",
      "summary": "summary",
      "status": "status",
      "currentNodeIndex": "currentNodeIndex",
      "nodesSnapshot": "nodesSnapshot",
      "comment": "comment",
      "updateFields": "updateFields",
      "submitterId": "submitterId",
      "submitterName": "submitterName",
      "finishedAt": "finishedAt",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "flow": {
        "prisma": "flow",
        "target": "approvalFlow",
        "cardinality": "N:1",
        "localFields": [
          "flowId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "flowVersion": {
        "prisma": "flowVersion",
        "target": "approvalFlowVersion",
        "cardinality": "N:1",
        "localFields": [
          "flowVersionId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "tasks": {
        "prisma": "approvalTasks",
        "target": "approvalTask",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "instanceId"
        ]
      },
      "records": {
        "prisma": "approvalRecords",
        "target": "approvalRecord",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "instanceId"
        ]
      },
      "addSignTasks": {
        "prisma": "approvalAddSignTasks",
        "target": "approvalAddSignTask",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "instanceId"
        ]
      },
      "returnBackRecords": {
        "prisma": "approvalReturnBackRecords",
        "target": "approvalReturnBackRecord",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "instanceId"
        ]
      },
      "attachments": {
        "prisma": "approvalInstanceAttachments",
        "target": "approvalInstanceAttachment",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "instanceId"
        ]
      },
      "webhookDeliveries": {
        "prisma": "approvalWebhookDeliveries",
        "target": "approvalWebhookDelivery",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "instanceId"
        ]
      }
    }
  },
  "approvalResourceSnapshot": {
    "model": "ApprovalResourceSnapshots",
    "table": "approval_resource_snapshots",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "formType": "formType",
      "resourceId": "resourceId",
      "snapshotData": "snapshotData",
      "createdById": "createdById",
      "updatedById": "updatedById",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {}
  },
  "approvalTask": {
    "model": "ApprovalTasks",
    "table": "approval_tasks",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "instanceId": "instanceId",
      "nodeId": "nodeId",
      "nodeIndex": "nodeIndex",
      "nodeRound": "nodeRound",
      "nodeName": "nodeName",
      "approverId": "approverId",
      "taskType": "taskType",
      "status": "status",
      "action": "action",
      "handledAt": "handledAt",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "instance": {
        "prisma": "instance",
        "target": "approvalInstance",
        "cardinality": "N:1",
        "localFields": [
          "instanceId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "records": {
        "prisma": "approvalRecords",
        "target": "approvalRecord",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "taskId"
        ]
      },
      "addSignTask": {
        "prisma": "approvalAddSignTasks",
        "target": "approvalAddSignTask",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "signTaskId"
        ]
      },
      "signedByTasks": {
        "prisma": "approvalAddSignTasks",
        "target": "approvalAddSignTask",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "signTaskId"
        ]
      },
      "returnBackRecords": {
        "prisma": "approvalReturnBackRecords",
        "target": "approvalReturnBackRecord",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "taskId"
        ]
      }
    }
  },
  "approvalAddSignTask": {
    "model": "ApprovalAddSignTasks",
    "table": "approval_add_sign_tasks",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "instanceId": "instanceId",
      "taskId": "taskId",
      "signTaskId": "signTaskId",
      "type": "_type",
      "rootTaskId": "rootTaskId",
      "sort": "sort",
      "comment": "comment",
      "createdById": "createdById",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "instance": {
        "prisma": "instance",
        "target": "approvalInstance",
        "cardinality": "N:1",
        "localFields": [
          "instanceId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "task": {
        "prisma": "task",
        "target": "approvalTask",
        "cardinality": "N:1",
        "localFields": [
          "taskId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "signTask": {
        "prisma": "signTask",
        "target": "approvalTask",
        "cardinality": "N:1",
        "localFields": [
          "signTaskId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "approvalRecord": {
    "model": "ApprovalRecords",
    "table": "approval_records",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "instanceId": "instanceId",
      "taskId": "taskId",
      "nodeId": "nodeId",
      "nodeRound": "nodeRound",
      "result": "result",
      "comment": "comment",
      "createdById": "createdById",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "instance": {
        "prisma": "instance",
        "target": "approvalInstance",
        "cardinality": "N:1",
        "localFields": [
          "instanceId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "task": {
        "prisma": "task",
        "target": "approvalTask",
        "cardinality": "N:1",
        "localFields": [
          "taskId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "approvalReturnBackRecord": {
    "model": "ApprovalReturnBackRecords",
    "table": "approval_return_back_records",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "instanceId": "instanceId",
      "taskId": "taskId",
      "returnToNodeId": "returnToNodeId",
      "returnReason": "returnReason",
      "returnUserId": "returnUserId",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "instance": {
        "prisma": "instance",
        "target": "approvalInstance",
        "cardinality": "N:1",
        "localFields": [
          "instanceId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "task": {
        "prisma": "task",
        "target": "approvalTask",
        "cardinality": "N:1",
        "localFields": [
          "taskId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "approvalInstanceAttachment": {
    "model": "ApprovalInstanceAttachments",
    "table": "approval_instance_attachments",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "instanceId": "instanceId",
      "elementId": "elementId",
      "attachmentId": "attachmentId",
      "createdAt": "createdAt"
    },
    "relations": {
      "instance": {
        "prisma": "instance",
        "target": "approvalInstance",
        "cardinality": "N:1",
        "localFields": [
          "instanceId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "attachment": {
        "prisma": "attachment",
        "target": "attachment",
        "cardinality": "N:1",
        "localFields": [
          "attachmentId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "approvalWebhookDelivery": {
    "model": "ApprovalWebhookDeliveries",
    "table": "approval_webhook_deliveries",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "instanceId": "instanceId",
      "flowId": "flowId",
      "flowVersionId": "flowVersionId",
      "nodeId": "nodeId",
      "nodeIndex": "nodeIndex",
      "action": "action",
      "source": "source",
      "method": "method",
      "targetOrigin": "targetOrigin",
      "targetPath": "targetPath",
      "status": "status",
      "httpStatus": "httpStatus",
      "responseBytes": "responseBytes",
      "durationMs": "durationMs",
      "errorCode": "errorCode",
      "errorMessage": "errorMessage",
      "createdById": "createdById",
      "startedAt": "startedAt",
      "finishedAt": "finishedAt",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "instance": {
        "prisma": "instance",
        "target": "approvalInstance",
        "cardinality": "N:1",
        "localFields": [
          "instanceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "biddingSource": {
    "model": "BiddingSources",
    "table": "bidding_sources",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "provider": "provider",
      "name": "name",
      "credentials": "credentials",
      "enabled": "enabled",
      "lastFetchAt": "lastFetchAt",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {}
  },
  "biddingKeywordSub": {
    "model": "BiddingKeywordSubs",
    "table": "bidding_keyword_subs",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "keyword": "keyword",
      "enabled": "enabled",
      "createdAt": "createdAt"
    },
    "relations": {}
  },
  "biddingInfo": {
    "model": "BiddingInfos",
    "table": "bidding_infos",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "title": "title",
      "type": "_type",
      "region": "region",
      "buyer": "buyer",
      "budget": "budget",
      "publishedAt": "publishedAt",
      "deadline": "deadline",
      "sourceUrl": "sourceUrl",
      "content": "content",
      "source": "source",
      "keyword": "keyword",
      "hash": "hash",
      "convertedLeadId": "convertedLeadId",
      "createdAt": "createdAt"
    },
    "relations": {}
  },
  "plan": {
    "model": "Plans",
    "table": "plans",
    "fields": {
      "id": "id",
      "code": "code",
      "name": "name",
      "price": "price",
      "maxUsers": "maxUsers",
      "features": "features",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "subscriptions": {
        "prisma": "subscriptions",
        "target": "subscription",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "planId"
        ]
      }
    }
  },
  "subscription": {
    "model": "Subscriptions",
    "table": "subscriptions",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "planId": "planId",
      "status": "status",
      "currentPeriodStart": "currentPeriodStart",
      "currentPeriodEnd": "currentPeriodEnd",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "plan": {
        "prisma": "plan",
        "target": "plan",
        "cardinality": "N:1",
        "localFields": [
          "planId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "customForm": {
    "model": "CustomForm",
    "table": "custom_form",
    "fields": {
      "id": "id",
      "name": "name",
      "enable": "enable",
      "organizationId": "organizationId",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "admins": {
        "prisma": "customFormAdmins",
        "target": "customFormAdmin",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "customFormId"
        ]
      },
      "roles": {
        "prisma": "customFormRoles",
        "target": "customFormRole",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "customFormId"
        ]
      },
      "data": {
        "prisma": "customFormData",
        "target": "customFormData",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "customFormId"
        ]
      }
    }
  },
  "customFormAdmin": {
    "model": "CustomFormAdmin",
    "table": "custom_form_admin",
    "fields": {
      "id": "id",
      "customFormId": "customFormId",
      "userId": "userId"
    },
    "relations": {
      "form": {
        "prisma": "customForm",
        "target": "customForm",
        "cardinality": "N:1",
        "localFields": [
          "customFormId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "customFormRole": {
    "model": "CustomFormRole",
    "table": "custom_form_role",
    "fields": {
      "id": "id",
      "name": "name",
      "customFormId": "customFormId",
      "internalKey": "internalKey",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "form": {
        "prisma": "customForm",
        "target": "customForm",
        "cardinality": "N:1",
        "localFields": [
          "customFormId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "users": {
        "prisma": "customFormRoleUsers",
        "target": "customFormRoleUser",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "roleId"
        ]
      }
    }
  },
  "customFormRoleUser": {
    "model": "CustomFormRoleUser",
    "table": "custom_form_role_user",
    "fields": {
      "id": "id",
      "roleId": "roleId",
      "userId": "userId",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "role": {
        "prisma": "role",
        "target": "customFormRole",
        "cardinality": "N:1",
        "localFields": [
          "roleId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "customFormData": {
    "model": "CustomFormData",
    "table": "custom_form_data",
    "fields": {
      "id": "id",
      "customFormId": "customFormId",
      "name": "name",
      "ownerId": "owner",
      "organizationId": "organizationId",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "form": {
        "prisma": "customForm",
        "target": "customForm",
        "cardinality": "N:1",
        "localFields": [
          "customFormId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "fieldValues": {
        "prisma": "customFormDataFields",
        "target": "customFormDataField",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      },
      "fieldBlobValues": {
        "prisma": "customFormDataFieldBlobs",
        "target": "customFormDataFieldBlob",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "resourceId"
        ]
      }
    }
  },
  "customFormDataField": {
    "model": "CustomFormDataField",
    "table": "custom_form_data_field",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue",
      "refSubId": "refSubId",
      "rowId": "rowId",
      "bizId": "bizId"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "customFormData",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "customFormDataFieldBlob": {
    "model": "CustomFormDataFieldBlob",
    "table": "custom_form_data_field_blob",
    "fields": {
      "id": "id",
      "resourceId": "resourceId",
      "fieldId": "fieldId",
      "fieldValue": "fieldValue",
      "refSubId": "refSubId",
      "rowId": "rowId",
      "bizId": "bizId"
    },
    "relations": {
      "resource": {
        "prisma": "resource",
        "target": "customFormData",
        "cardinality": "N:1",
        "localFields": [
          "resourceId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "sysModuleForm": {
    "model": "SysModuleForm",
    "table": "sys_module_form",
    "fields": {
      "id": "id",
      "formKey": "formKey",
      "organizationId": "organizationId",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "blob": {
        "prisma": "sysModuleFormBlob",
        "target": "sysModuleFormBlob",
        "cardinality": "1:1",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "id"
        ]
      },
      "fields": {
        "prisma": "sysModuleFields",
        "target": "sysModuleField",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "formId"
        ]
      }
    }
  },
  "sysModuleFormBlob": {
    "model": "SysModuleFormBlob",
    "table": "sys_module_form_blob",
    "fields": {
      "id": "id",
      "prop": "prop"
    },
    "relations": {
      "form": {
        "prisma": "sysModuleForm",
        "target": "sysModuleForm",
        "cardinality": "N:1",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "sysModuleField": {
    "model": "SysModuleField",
    "table": "sys_module_field",
    "fields": {
      "id": "id",
      "formId": "formId",
      "internalKey": "internalKey",
      "name": "name",
      "type": "_type",
      "mobile": "mobile",
      "pos": "pos",
      "createUser": "createUser",
      "createTime": "createTime",
      "updateUser": "updateUser",
      "updateTime": "updateTime"
    },
    "relations": {
      "form": {
        "prisma": "form",
        "target": "sysModuleForm",
        "cardinality": "N:1",
        "localFields": [
          "formId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "blob": {
        "prisma": "sysModuleFieldBlob",
        "target": "sysModuleFieldBlob",
        "cardinality": "1:1",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "sysModuleFieldBlob": {
    "model": "SysModuleFieldBlob",
    "table": "sys_module_field_blob",
    "fields": {
      "id": "id",
      "prop": "prop"
    },
    "relations": {
      "field": {
        "prisma": "sysModuleField",
        "target": "sysModuleField",
        "cardinality": "N:1",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "sysUserView": {
    "model": "SysUserView",
    "table": "sys_user_view",
    "fields": {
      "id": "id",
      "userId": "userId",
      "name": "name",
      "fixed": "fixed",
      "resourceType": "resourceType",
      "organizationId": "organizationId",
      "pos": "pos",
      "enable": "enable",
      "searchMode": "searchMode",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "conditions": {
        "prisma": "sysUserViewConditions",
        "target": "sysUserViewCondition",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "sysUserViewId"
        ]
      }
    }
  },
  "sysUserViewCondition": {
    "model": "SysUserViewCondition",
    "table": "sys_user_view_condition",
    "fields": {
      "id": "id",
      "sysUserViewId": "sysUserViewId",
      "name": "name",
      "value": "value",
      "valueType": "valueType",
      "type": "_type",
      "multipleValue": "multipleValue",
      "operator": "operator",
      "childrenValue": "childrenValue",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "view": {
        "prisma": "sysUserView",
        "target": "sysUserView",
        "cardinality": "N:1",
        "localFields": [
          "sysUserViewId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "dashboardModule": {
    "model": "DashboardModule",
    "table": "dashboard_module",
    "fields": {
      "id": "id",
      "organizationId": "organizationId",
      "name": "name",
      "parentId": "parentId",
      "pos": "pos",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "dashboards": {
        "prisma": "dashboards",
        "target": "dashboard",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "dashboardModuleId"
        ]
      }
    }
  },
  "dashboard": {
    "model": "Dashboard",
    "table": "dashboard",
    "fields": {
      "id": "id",
      "name": "name",
      "resourceUrl": "resourceUrl",
      "dashboardModuleId": "dashboardModuleId",
      "organizationId": "organizationId",
      "pos": "pos",
      "scopeId": "scopeId",
      "description": "description",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "module": {
        "prisma": "dashboardModule",
        "target": "dashboardModule",
        "cardinality": "N:1",
        "localFields": [
          "dashboardModuleId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "collections": {
        "prisma": "dashboardCollections",
        "target": "dashboardCollection",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "dashboardId"
        ]
      }
    }
  },
  "dashboardCollection": {
    "model": "DashboardCollection",
    "table": "dashboard_collection",
    "fields": {
      "id": "id",
      "userId": "userId",
      "dashboardId": "dashboardId",
      "createTime": "createTime",
      "updateTime": "updateTime",
      "createUser": "createUser",
      "updateUser": "updateUser"
    },
    "relations": {
      "dashboard": {
        "prisma": "dashboard",
        "target": "dashboard",
        "cardinality": "N:1",
        "localFields": [
          "dashboardId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "operationLog": {
    "model": "OperationLogs",
    "table": "operation_logs",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "userId": "userId",
      "userName": "userName",
      "module": "module",
      "action": "action",
      "targetId": "targetId",
      "targetName": "targetName",
      "ip": "ip",
      "createdAt": "createdAt"
    },
    "relations": {
      "blob": {
        "prisma": "operationLogBlobs",
        "target": "operationLogBlob",
        "cardinality": "1:1",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "operationLogId"
        ]
      }
    }
  },
  "operationLogBlob": {
    "model": "OperationLogBlobs",
    "table": "operation_log_blobs",
    "fields": {
      "operationLogId": "operationLogId",
      "detail": "detail"
    },
    "relations": {
      "operationLog": {
        "prisma": "operationLog",
        "target": "operationLog",
        "cardinality": "N:1",
        "localFields": [
          "operationLogId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "operationLogSetting": {
    "model": "OperationLogSettings",
    "table": "operation_log_settings",
    "fields": {
      "tenantId": "tenantId",
      "retentionDays": "retentionDays",
      "lastCleanupAt": "lastCleanupAt",
      "lastCleanupDeleted": "lastCleanupDeleted",
      "lastCleanupSource": "lastCleanupSource",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "loginLog": {
    "model": "LoginLogs",
    "table": "login_logs",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "userId": "userId",
      "email": "email",
      "authType": "authType",
      "externalSubject": "externalSubject",
      "externalIdentityId": "externalIdentityId",
      "ip": "ip",
      "userAgent": "userAgent",
      "success": "success",
      "message": "message",
      "createdAt": "createdAt"
    },
    "relations": {}
  },
  "notification": {
    "model": "Notifications",
    "table": "notifications",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "userId": "userId",
      "type": "_type",
      "title": "title",
      "content": "content",
      "link": "link",
      "linkLabel": "linkLabel",
      "sourceType": "sourceType",
      "sourceId": "sourceId",
      "readAt": "readAt",
      "createdAt": "createdAt"
    },
    "relations": {}
  },
  "announcement": {
    "model": "Announcements",
    "table": "announcements",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "subject": "subject",
      "content": "content",
      "startAt": "startAt",
      "endAt": "endAt",
      "url": "url",
      "linkName": "linkName",
      "departmentIds": "departmentIds",
      "userIds": "userIds",
      "receiverUserIds": "receiverUserIds",
      "notice": "notice",
      "createUserId": "createUserId",
      "updateUserId": "updateUserId",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {}
  },
  "messageTaskSetting": {
    "model": "MessageTaskSettings",
    "table": "message_task_settings",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "module": "module",
      "event": "event",
      "systemEnabled": "systemEnabled",
      "emailEnabled": "emailEnabled",
      "weComEnabled": "weComEnabled",
      "dingTalkEnabled": "dingTalkEnabled",
      "larkEnabled": "larkEnabled",
      "config": "config",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "enterpriseUiSetting": {
    "model": "EnterpriseUiSettings",
    "table": "enterprise_ui_settings",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "theme": "theme",
      "customTheme": "customTheme",
      "style": "style",
      "customStyle": "customStyle",
      "title": "title",
      "slogan": "slogan",
      "helpDoc": "helpDoc",
      "iconAttachmentId": "iconAttachmentId",
      "loginLogoAttachmentId": "loginLogoAttachmentId",
      "loginImageAttachmentId": "loginImageAttachmentId",
      "platformLogoAttachmentId": "platformLogoAttachmentId",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "enterpriseMailSetting": {
    "model": "EnterpriseMailSettings",
    "table": "enterprise_mail_settings",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "host": "host",
      "port": "port",
      "account": "account",
      "passwordCiphertext": "passwordCiphertext",
      "passwordIv": "passwordIv",
      "passwordAuthTag": "passwordAuthTag",
      "passwordKeyVersion": "passwordKeyVersion",
      "fromAddress": "fromAddress",
      "recipient": "recipient",
      "ssl": "ssl",
      "tls": "tls",
      "lastTestSucceeded": "lastTestSucceeded",
      "lastTestMessage": "lastTestMessage",
      "lastTestedAt": "lastTestedAt",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "enterpriseAiModel": {
    "model": "EnterpriseAiModels",
    "table": "enterprise_ai_models",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "displayName": "displayName",
      "modelName": "modelName",
      "provider": "provider",
      "apiUrl": "apiUrl",
      "apiKeyCiphertext": "apiKeyCiphertext",
      "apiKeyIv": "apiKeyIv",
      "apiKeyAuthTag": "apiKeyAuthTag",
      "apiKeyKeyVersion": "apiKeyKeyVersion",
      "enable": "enable",
      "temperature": "temperature",
      "maxTokens": "maxTokens",
      "topP": "topP",
      "globalDailyLimit": "globalDailyLimit",
      "userDailyLimit": "userDailyLimit",
      "createdById": "createdById",
      "updatedById": "updatedById",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "taskBindings": {
        "prisma": "enterpriseGlobalTasks",
        "target": "enterpriseGlobalTask",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "applicableModelId"
        ]
      }
    }
  },
  "enterpriseAiModelRoute": {
    "model": "EnterpriseAiModelRoutes",
    "table": "enterprise_ai_model_routes",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "modelId": "modelId",
      "sort": "sort",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "enterpriseTermCategory": {
    "model": "EnterpriseTermCategories",
    "table": "enterprise_term_categories",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "name": "name",
      "sort": "sort",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "terms": {
        "prisma": "enterpriseTerms",
        "target": "enterpriseTerm",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "categoryId"
        ]
      }
    }
  },
  "enterpriseTerm": {
    "model": "EnterpriseTerms",
    "table": "enterprise_terms",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "categoryId": "categoryId",
      "standardTerm": "standardTerm",
      "alsoCalled": "alsoCalled",
      "avoidThese": "avoidThese",
      "useCase": "useCase",
      "systemReference": "systemReference",
      "enable": "enable",
      "createdById": "createdById",
      "updatedById": "updatedById",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "category": {
        "prisma": "category",
        "target": "enterpriseTermCategory",
        "cardinality": "N:1",
        "localFields": [
          "categoryId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "enterpriseTermDiscovery": {
    "model": "EnterpriseTermDiscoveries",
    "table": "enterprise_term_discoveries",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "discovered": "discovered",
      "source": "source",
      "context": "context",
      "status": "status",
      "adoptedTermId": "adoptedTermId",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "enterpriseGlobalTask": {
    "model": "EnterpriseGlobalTasks",
    "table": "enterprise_global_tasks",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "name": "name",
      "triggerType": "triggerType",
      "executionCondition": "executionCondition",
      "executionAction": "executionAction",
      "confirmationLevel": "confirmationLevel",
      "applicableModelId": "applicableModelId",
      "enable": "enable",
      "createdById": "createdById",
      "updatedById": "updatedById",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "applicableModel": {
        "prisma": "applicableModel",
        "target": "enterpriseAiModel",
        "cardinality": "N:1",
        "localFields": [
          "applicableModelId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "executions": {
        "prisma": "enterpriseGlobalTaskExecutions",
        "target": "enterpriseGlobalTaskExecution",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "taskId"
        ]
      }
    }
  },
  "enterpriseGlobalTaskExecution": {
    "model": "EnterpriseGlobalTaskExecutions",
    "table": "enterprise_global_task_executions",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "taskId": "taskId",
      "status": "status",
      "input": "input",
      "output": "output",
      "errorMessage": "errorMessage",
      "startedAt": "startedAt",
      "finishedAt": "finishedAt",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "task": {
        "prisma": "task",
        "target": "enterpriseGlobalTask",
        "cardinality": "N:1",
        "localFields": [
          "taskId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "enterpriseIntegration": {
    "model": "EnterpriseIntegrations",
    "table": "enterprise_integrations",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "provider": "provider",
      "corpId": "corpId",
      "clientId": "clientId",
      "agentId": "agentId",
      "redirectUrl": "redirectUrl",
      "secretCiphertext": "secretCiphertext",
      "secretIv": "secretIv",
      "secretAuthTag": "secretAuthTag",
      "secretKeyVersion": "secretKeyVersion",
      "credentialVersion": "credentialVersion",
      "syncEnabled": "syncEnabled",
      "syncDefaultRoleId": "syncDefaultRoleId",
      "lastTestSucceeded": "lastTestSucceeded",
      "lastTestMessage": "lastTestMessage",
      "lastTestedAt": "lastTestedAt",
      "lastSyncStatus": "lastSyncStatus",
      "lastSyncMessage": "lastSyncMessage",
      "lastSyncedAt": "lastSyncedAt",
      "createdById": "createdById",
      "updatedById": "updatedById",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "syncDefaultRole": {
        "prisma": "syncDefaultRole",
        "target": "role",
        "cardinality": "N:1",
        "localFields": [
          "syncDefaultRoleId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "syncBatches": {
        "prisma": "organizationSyncBatches",
        "target": "organizationSyncBatch",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "integrationId"
        ]
      },
      "externalIdentities": {
        "prisma": "externalIdentities",
        "target": "externalIdentity",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "integrationId"
        ]
      },
      "oauthStates": {
        "prisma": "externalOauthStates",
        "target": "externalOAuthState",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "integrationId"
        ]
      },
      "messageDeliveries": {
        "prisma": "messageDeliveries",
        "target": "messageDelivery",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "integrationId"
        ]
      }
    }
  },
  "externalDepartmentMapping": {
    "model": "ExternalDepartmentMappings",
    "table": "external_department_mappings",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "provider": "provider",
      "externalId": "externalId",
      "externalKey": "externalKey",
      "departmentId": "departmentId",
      "active": "active",
      "lastSeenBatchId": "lastSeenBatchId",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "department": {
        "prisma": "department",
        "target": "department",
        "cardinality": "N:1",
        "localFields": [
          "departmentId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "lastSeenBatch": {
        "prisma": "lastSeenBatch",
        "target": "organizationSyncBatch",
        "cardinality": "N:1",
        "localFields": [
          "lastSeenBatchId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "externalUserMapping": {
    "model": "ExternalUserMappings",
    "table": "external_user_mappings",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "provider": "provider",
      "externalId": "externalId",
      "externalKey": "externalKey",
      "userId": "userId",
      "active": "active",
      "lastSeenBatchId": "lastSeenBatchId",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "user": {
        "prisma": "user",
        "target": "user",
        "cardinality": "N:1",
        "localFields": [
          "userId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "lastSeenBatch": {
        "prisma": "lastSeenBatch",
        "target": "organizationSyncBatch",
        "cardinality": "N:1",
        "localFields": [
          "lastSeenBatchId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "externalIdentity": {
    "model": "ExternalIdentities",
    "table": "external_identities",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "integrationId": "integrationId",
      "mappingId": "mappingId",
      "provider": "provider",
      "externalSubject": "externalSubject",
      "userId": "userId",
      "status": "status",
      "bindingSource": "bindingSource",
      "boundById": "boundById",
      "boundAt": "boundAt",
      "revokedById": "revokedById",
      "revokedAt": "revokedAt",
      "lastLoginAt": "lastLoginAt",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "integration": {
        "prisma": "integration",
        "target": "enterpriseIntegration",
        "cardinality": "N:1",
        "localFields": [
          "integrationId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "mapping": {
        "prisma": "mapping",
        "target": "externalUserMapping",
        "cardinality": "N:1",
        "localFields": [
          "mappingId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "user": {
        "prisma": "user",
        "target": "user",
        "cardinality": "N:1",
        "localFields": [
          "userId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "externalOAuthState": {
    "model": "ExternalOauthStates",
    "table": "external_oauth_states",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "integrationId": "integrationId",
      "flow": "flow",
      "stateHash": "stateHash",
      "browserNonceHash": "browserNonceHash",
      "returnPath": "returnPath",
      "expiresAt": "expiresAt",
      "consumedAt": "consumedAt",
      "createdAt": "createdAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "integration": {
        "prisma": "integration",
        "target": "enterpriseIntegration",
        "cardinality": "N:1",
        "localFields": [
          "integrationId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "messageDelivery": {
    "model": "MessageDeliveries",
    "table": "message_deliveries",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "integrationId": "integrationId",
      "channel": "channel",
      "event": "event",
      "userId": "userId",
      "externalSubject": "externalSubject",
      "title": "title",
      "content": "content",
      "link": "link",
      "status": "status",
      "attempts": "attempts",
      "maxAttempts": "maxAttempts",
      "nextAttemptAt": "nextAttemptAt",
      "providerMessageId": "providerMessageId",
      "errorCode": "errorCode",
      "errorMessage": "errorMessage",
      "sentAt": "sentAt",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "integration": {
        "prisma": "integration",
        "target": "enterpriseIntegration",
        "cardinality": "N:1",
        "localFields": [
          "integrationId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "user": {
        "prisma": "user",
        "target": "user",
        "cardinality": "N:1",
        "localFields": [
          "userId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "organizationSyncBatch": {
    "model": "OrganizationSyncBatches",
    "table": "organization_sync_batches",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "integrationId": "integrationId",
      "provider": "provider",
      "status": "status",
      "targetDepartmentId": "targetDepartmentId",
      "credentialVersion": "credentialVersion",
      "counts": "counts",
      "errorCode": "errorCode",
      "errorMessage": "errorMessage",
      "createdById": "createdById",
      "appliedById": "appliedById",
      "fetchStartedAt": "fetchStartedAt",
      "previewedAt": "previewedAt",
      "applyStartedAt": "applyStartedAt",
      "finishedAt": "finishedAt",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "integration": {
        "prisma": "integration",
        "target": "enterpriseIntegration",
        "cardinality": "N:1",
        "localFields": [
          "integrationId"
        ],
        "targetFields": [
          "id"
        ]
      },
      "items": {
        "prisma": "organizationSyncItems",
        "target": "organizationSyncItem",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "batchId"
        ]
      },
      "seenDepartmentMappings": {
        "prisma": "externalDepartmentMappings",
        "target": "externalDepartmentMapping",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "lastSeenBatchId"
        ]
      },
      "seenUserMappings": {
        "prisma": "externalUserMappings",
        "target": "externalUserMapping",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "lastSeenBatchId"
        ]
      }
    }
  },
  "organizationSyncItem": {
    "model": "OrganizationSyncItems",
    "table": "organization_sync_items",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "batchId": "batchId",
      "resourceType": "resourceType",
      "externalId": "externalId",
      "externalKey": "externalKey",
      "action": "action",
      "result": "result",
      "localId": "localId",
      "parentExternalKey": "parentExternalKey",
      "sourceData": "sourceData",
      "changes": "changes",
      "conflictType": "conflictType",
      "conflictMessage": "conflictMessage",
      "resolution": "resolution",
      "resolvedLocalId": "resolvedLocalId",
      "errorMessage": "errorMessage",
      "sort": "sort",
      "createdAt": "createdAt",
      "updatedAt": "updatedAt"
    },
    "relations": {
      "batch": {
        "prisma": "batch",
        "target": "organizationSyncBatch",
        "cardinality": "N:1",
        "localFields": [
          "batchId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "moduleConfig": {
    "model": "ModuleConfigs",
    "table": "module_configs",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "key": "key",
      "enabled": "enabled",
      "sort": "sort"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "topNavigationConfig": {
    "model": "TopNavigationConfigs",
    "table": "top_navigation_configs",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "key": "key",
      "enabled": "enabled",
      "sort": "sort"
    },
    "relations": {
      "tenant": {
        "prisma": "tenant",
        "target": "tenant",
        "cardinality": "N:1",
        "localFields": [
          "tenantId"
        ],
        "targetFields": [
          "id"
        ]
      }
    }
  },
  "attachment": {
    "model": "Attachments",
    "table": "attachments",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "uploaderId": "uploaderId",
      "name": "name",
      "path": "path",
      "size": "size",
      "mime": "mime",
      "targetType": "targetType",
      "targetId": "targetId",
      "createdAt": "createdAt"
    },
    "relations": {
      "approvalInstanceAttachments": {
        "prisma": "approvalInstanceAttachments",
        "target": "approvalInstanceAttachment",
        "cardinality": "1:N",
        "localFields": [
          "id"
        ],
        "targetFields": [
          "attachmentId"
        ]
      }
    }
  },
  "exportTask": {
    "model": "ExportTasks",
    "table": "export_tasks",
    "fields": {
      "id": "id",
      "tenantId": "tenantId",
      "userId": "userId",
      "module": "module",
      "fileName": "fileName",
      "filePath": "filePath",
      "status": "status",
      "rowCount": "rowCount",
      "fileSize": "fileSize",
      "errorMessage": "errorMessage",
      "payload": "payload",
      "startedAt": "startedAt",
      "attempts": "attempts",
      "completedAt": "completedAt",
      "expiresAt": "expiresAt",
      "createdAt": "createdAt"
    },
    "relations": {}
  }
} as const

export type PrismaFixtureModelName = keyof typeof PRISMA_FIXTURE_MODELS
