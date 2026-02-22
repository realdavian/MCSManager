<script setup lang="ts">
import { ref, computed } from "vue";
import { t } from "@/lang/i18n";
import type { InstanceDetail } from "@/types";
import { listBackups, deleteBackup, type BackupInfo } from "@/services/apis/backup";
import { message, Modal } from "ant-design-vue";
import { reportErrorMsg } from "@/tools/validator";
import { DeleteOutlined, ReloadOutlined, CloudOutlined } from "@ant-design/icons-vue";
import { parseTimestamp } from "@/tools/time";

const props = defineProps<{
  instanceInfo?: InstanceDetail;
  instanceId?: string;
  daemonId?: string;
}>();

const open = ref(false);
const backups = ref<BackupInfo[]>([]);
const loading = ref(false);

const providerId = computed(() => props.instanceInfo?.config?.backupConfig?.providerId ?? "");

const { execute: executeListBackups } = listBackups();
const { execute: executeDeleteBackup, isLoading: deleteLoading } = deleteBackup();

const columns = [
  {
    title: t("TXT_CODE_backup_filename"),
    dataIndex: "name",
    key: "name",
    ellipsis: true
  },
  {
    title: t("TXT_CODE_backup_size"),
    dataIndex: "size",
    key: "size",
    width: 120
  },
  {
    title: t("TXT_CODE_backup_createdAt"),
    dataIndex: "lastModified",
    key: "lastModified",
    width: 180
  },
  {
    title: t("TXT_CODE_backup_trigger"),
    dataIndex: "trigger",
    key: "trigger",
    width: 100
  },
  {
    title: t("TXT_CODE_backup_actions"),
    key: "actions",
    width: 80
  }
];

const formatSize = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const formatDate = (dateStr: string): string => {
  try {
    return parseTimestamp(new Date(dateStr).getTime());
  } catch {
    return dateStr;
  }
};

const loadBackups = async () => {
  if (!props.daemonId || !props.instanceId || !providerId.value) {
    backups.value = [];
    return;
  }
  
  loading.value = true;
  try {
    const res = await executeListBackups({
      params: {
        daemonId: props.daemonId,
        instanceUuid: props.instanceId,
        providerId: providerId.value
      }
    });
    backups.value = res.value?.backups || [];
  } catch (err: any) {
    console.error("Failed to load backups:", err);
    backups.value = [];
  } finally {
    loading.value = false;
  }
};

const openDialog = async () => {
  open.value = true;
  await loadBackups();
};

const handleDelete = (record: BackupInfo) => {
  Modal.confirm({
    title: t("TXT_CODE_backup_confirmDelete"),
    content: record.name,
    okType: "danger",
    onOk: async () => {
      try {
        await executeDeleteBackup({
          params: {
            daemonId: props.daemonId ?? "",
            providerId: providerId.value,
            remotePath: record.remotePath
          }
        });
        message.success(t("TXT_CODE_28190dbc"));
        await loadBackups();
      } catch (err: any) {
        reportErrorMsg(err.message);
      }
    }
  });
};

defineExpose({
  openDialog
});
</script>

<template>
  <a-modal
    v-model:open="open"
    centered
    :title="t('TXT_CODE_backup_viewBackups')"
    :footer="null"
    :width="800"
  >
    <div>
      <div style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center">
        <a-typography-text v-if="!providerId" type="warning">
          {{ t("TXT_CODE_backup_noProviderConfigured") }}
        </a-typography-text>
        <span v-else></span>
        <a-button :loading="loading" @click="loadBackups">
          <template #icon><ReloadOutlined /></template>
          {{ t("TXT_CODE_backup_refresh") }}
        </a-button>
      </div>

      <a-table
        :columns="columns"
        :data-source="backups"
        :loading="loading"
        :pagination="{ pageSize: 10 }"
        row-key="remotePath"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'size'">
            {{ formatSize(record.size) }}
          </template>
          <template v-else-if="column.key === 'lastModified'">
            {{ formatDate(record.lastModified) }}
          </template>
          <template v-else-if="column.key === 'trigger'">
            <a-tag :color="record.trigger === 'manual' ? 'blue' : record.trigger === 'scheduled' ? 'green' : 'orange'">
              {{ record.trigger }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'actions'">
            <a-button
              type="text"
              danger
              size="small"
              :loading="deleteLoading"
              @click="handleDelete(record)"
            >
              <template #icon><DeleteOutlined /></template>
            </a-button>
          </template>
        </template>

        <template #emptyText>
          <a-empty :description="t('TXT_CODE_backup_noBackups')">
            <template #image>
              <CloudOutlined style="font-size: 48px; color: #999" />
            </template>
          </a-empty>
        </template>
      </a-table>
    </div>
  </a-modal>
</template>
