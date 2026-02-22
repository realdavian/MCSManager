<script setup lang="ts">
import { ref, reactive, onMounted, computed } from "vue";
import { t } from "@/lang/i18n";
import {
  getBackupProviders,
  addBackupProvider,
  testBackupProvider,
  deleteBackupProvider,
  type BackupProvider,
  type S3Config,
  type GCSConfig
} from "@/services/apis/backup";
import { remoteNodeList } from "@/services/apis";
import type { NodeStatus } from "@/types";
import { message, Modal, type FormInstance } from "ant-design-vue";
import { reportErrorMsg } from "@/tools/validator";
import {
  PlusOutlined,
  DeleteOutlined,
  CloudOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined
} from "@ant-design/icons-vue";

const props = defineProps<{
  maxHeight?: string;
}>();

const providers = ref<(BackupProvider & { daemonId: string })[]>([]);
const daemons = ref<NodeStatus[]>([]);
const loading = ref(false);
const selectedDaemonId = ref<string>("");
const testResults = ref<Record<string, boolean | null>>({});

const addDialogVisible = ref(false);
const addFormRef = ref<FormInstance>();
const addLoading = ref(false);

const addFormData = reactive({
  name: "",
  type: "s3" as "s3" | "gcs",
  s3: {
    bucket: "",
    region: "us-east-1",
    accessKeyId: "",
    secretAccessKey: "",
    endpoint: ""
  },
  gcs: {
    bucket: "",
    projectId: "",
    keyFilename: ""
  }
});

const { execute: executeGetDaemons } = remoteNodeList();
const { execute: executeGetProviders } = getBackupProviders();
const { execute: executeAddProvider, isLoading: addProviderLoading } = addBackupProvider();
const { execute: executeTestProvider } = testBackupProvider();
const { execute: executeDeleteProvider } = deleteBackupProvider();

const loadDaemons = async () => {
  try {
    const res = await executeGetDaemons();
    daemons.value = res.value || [];
    if (daemons.value.length > 0 && !selectedDaemonId.value) {
      selectedDaemonId.value = daemons.value[0].uuid;
    }
  } catch (err) {
    console.error("Failed to load daemons:", err);
  }
};

const loadProviders = async () => {
  if (!selectedDaemonId.value) return;
  loading.value = true;
  try {
    const res = await executeGetProviders({
      params: { daemonId: selectedDaemonId.value }
    });
    providers.value = (res.value?.providers || []).map((p) => ({
      ...p,
      daemonId: selectedDaemonId.value
    }));
  } catch (err) {
    console.error("Failed to load providers:", err);
    providers.value = [];
  } finally {
    loading.value = false;
  }
};

const handleDaemonChange = () => {
  testResults.value = {};
  loadProviders();
};

const openAddDialog = () => {
  addFormData.name = "";
  addFormData.type = "s3";
  addFormData.s3 = { bucket: "", region: "us-east-1", accessKeyId: "", secretAccessKey: "", endpoint: "" };
  addFormData.gcs = { bucket: "", projectId: "", keyFilename: "" };
  addDialogVisible.value = true;
};

const handleAdd = async () => {
  try {
    await addFormRef.value?.validateFields();
    
    const config = addFormData.type === "s3" 
      ? addFormData.s3 as S3Config
      : addFormData.gcs as GCSConfig;

    await executeAddProvider({
      params: { daemonId: selectedDaemonId.value },
      data: {
        name: addFormData.name,
        type: addFormData.type,
        config
      }
    });

    message.success(t("TXT_CODE_d3de39b4"));
    addDialogVisible.value = false;
    loadProviders();
  } catch (err: any) {
    reportErrorMsg(err.message);
  }
};

const handleTest = async (provider: BackupProvider) => {
  testResults.value[provider.id] = null;
  try {
    const res = await executeTestProvider({
      params: {
        daemonId: selectedDaemonId.value,
        providerId: provider.id
      }
    });
    testResults.value[provider.id] = res.value?.success ?? false;
    if (res.value?.success) {
      message.success(t("TXT_CODE_backup_connectionSuccess"));
    } else {
      message.error(t("TXT_CODE_backup_connectionFailed"));
    }
  } catch (err: any) {
    testResults.value[provider.id] = false;
    reportErrorMsg(err.message);
  }
};

const handleDelete = (provider: BackupProvider) => {
  Modal.confirm({
    title: t("TXT_CODE_backup_confirmDeleteProvider"),
    content: provider.name,
    okType: "danger",
    onOk: async () => {
      try {
        await executeDeleteProvider({
          params: {
            daemonId: selectedDaemonId.value,
            providerId: provider.id
          }
        });
        message.success(t("TXT_CODE_28190dbc"));
        loadProviders();
      } catch (err: any) {
        reportErrorMsg(err.message);
      }
    }
  });
};

onMounted(async () => {
  await loadDaemons();
  if (selectedDaemonId.value) {
    await loadProviders();
  }
});

const columns = [
  { title: t("TXT_CODE_backup_providerName"), dataIndex: "name", key: "name" },
  { title: t("TXT_CODE_backup_providerType"), dataIndex: "type", key: "type", width: 100 },
  { title: t("TXT_CODE_backup_status"), key: "status", width: 120 },
  { title: t("TXT_CODE_backup_actions"), key: "actions", width: 160 }
];
</script>

<template>
  <div class="backup-providers">
    <div class="header-row">
      <a-space>
        <span>{{ t("TXT_CODE_backup_selectDaemon") }}:</span>
        <a-select
          v-model:value="selectedDaemonId"
          style="min-width: 200px"
          @change="handleDaemonChange"
        >
          <a-select-option v-for="d in daemons" :key="d.uuid" :value="d.uuid">
            {{ d.remarks || d.ip }}
          </a-select-option>
        </a-select>
      </a-space>
      <a-button type="primary" :disabled="!selectedDaemonId" @click="openAddDialog">
        <template #icon><PlusOutlined /></template>
        {{ t("TXT_CODE_backup_addProvider") }}
      </a-button>
    </div>

    <a-table
      :columns="columns"
      :data-source="providers"
      :loading="loading"
      :pagination="false"
      row-key="id"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'type'">
          <a-tag :color="record.type === 's3' ? 'orange' : 'blue'">
            {{ record.type.toUpperCase() }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'status'">
          <span v-if="testResults[record.id] === true">
            <CheckCircleOutlined style="color: #52c41a" /> {{ t("TXT_CODE_backup_connected") }}
          </span>
          <span v-else-if="testResults[record.id] === false">
            <CloseCircleOutlined style="color: #ff4d4f" /> {{ t("TXT_CODE_backup_failed") }}
          </span>
          <span v-else>-</span>
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-space>
            <a-button size="small" @click="handleTest(record)">
              {{ t("TXT_CODE_backup_test") }}
            </a-button>
            <a-button size="small" danger @click="handleDelete(record)">
              <template #icon><DeleteOutlined /></template>
            </a-button>
          </a-space>
        </template>
      </template>

      <template #emptyText>
        <a-empty :description="t('TXT_CODE_backup_noProviders')">
          <template #image>
            <CloudOutlined style="font-size: 48px; color: #999" />
          </template>
        </a-empty>
      </template>
    </a-table>

    <!-- Add Provider Dialog -->
    <a-modal
      v-model:open="addDialogVisible"
      :title="t('TXT_CODE_backup_addProvider')"
      :confirm-loading="addProviderLoading"
      :width="500"
      @ok="handleAdd"
    >
      <a-form ref="addFormRef" :model="addFormData" layout="vertical">
        <a-form-item
          name="name"
          :label="t('TXT_CODE_backup_providerName')"
          :rules="[{ required: true, message: t('TXT_CODE_backup_nameRequired') }]"
        >
          <a-input v-model:value="addFormData.name" />
        </a-form-item>

        <a-form-item :label="t('TXT_CODE_backup_providerType')">
          <a-radio-group v-model:value="addFormData.type">
            <a-radio-button value="s3">S3 / S3-Compatible</a-radio-button>
            <a-radio-button value="gcs">Google Cloud Storage</a-radio-button>
          </a-radio-group>
        </a-form-item>

        <!-- S3 Config -->
        <template v-if="addFormData.type === 's3'">
          <a-form-item
            name="s3.bucket"
            :label="t('TXT_CODE_backup_bucketName')"
            :rules="[{ required: true }]"
          >
            <a-input v-model:value="addFormData.s3.bucket" />
          </a-form-item>
          <a-form-item :label="t('TXT_CODE_backup_s3Region')">
            <a-input v-model:value="addFormData.s3.region" placeholder="us-east-1" />
          </a-form-item>
          <a-form-item
            name="s3.accessKeyId"
            :label="t('TXT_CODE_backup_s3AccessKey')"
            :rules="[{ required: true }]"
          >
            <a-input v-model:value="addFormData.s3.accessKeyId" />
          </a-form-item>
          <a-form-item
            name="s3.secretAccessKey"
            :label="t('TXT_CODE_backup_s3SecretKey')"
            :rules="[{ required: true }]"
          >
            <a-input-password v-model:value="addFormData.s3.secretAccessKey" />
          </a-form-item>
          <a-form-item :label="t('TXT_CODE_backup_s3Endpoint')">
            <a-input v-model:value="addFormData.s3.endpoint" :placeholder="t('TXT_CODE_backup_s3EndpointHint')" />
          </a-form-item>
        </template>

        <!-- GCS Config -->
        <template v-if="addFormData.type === 'gcs'">
          <a-form-item
            name="gcs.bucket"
            :label="t('TXT_CODE_backup_bucketName')"
            :rules="[{ required: true }]"
          >
            <a-input v-model:value="addFormData.gcs.bucket" />
          </a-form-item>
          <a-form-item
            name="gcs.projectId"
            :label="t('TXT_CODE_backup_gcsProjectId')"
            :rules="[{ required: true }]"
          >
            <a-input v-model:value="addFormData.gcs.projectId" />
          </a-form-item>
          <a-form-item :label="t('TXT_CODE_backup_gcsKeyFile')">
            <a-input v-model:value="addFormData.gcs.keyFilename" :placeholder="t('TXT_CODE_backup_gcsKeyFileHint')" />
          </a-form-item>
        </template>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.backup-providers {
  padding: 16px;
}
.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
</style>
