<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { t } from "@/lang/i18n";
import type { InstanceDetail } from "@/types";
import { updateInstanceConfig } from "@/services/apis/instance";
import { getBackupProviders, createBackup, type BackupProvider } from "@/services/apis/backup";
import { message, type FormInstance } from "ant-design-vue";
import { reportErrorMsg } from "@/tools/validator";
import { CloudUploadOutlined } from "@ant-design/icons-vue";

const formRef = ref<FormInstance>();

const props = defineProps<{
  instanceInfo?: InstanceDetail;
  instanceId?: string;
  daemonId?: string;
}>();

const emit = defineEmits(["update"]);

const open = ref(false);
const providers = ref<BackupProvider[]>([]);
const loadingProviders = ref(false);
const backupInProgress = ref(false);

const formData = reactive({
  enabled: false,
  providerId: "",
  scheduledBackup: false,
  scheduleInterval: 360,
  onStopBackup: true,
  selectedPaths: [] as string[]
});

const { execute: executeGetProviders } = getBackupProviders();
const { execute: executeUpdateConfig, isLoading } = updateInstanceConfig();
const { execute: executeCreateBackup } = createBackup();

const loadProviders = async () => {
  if (!props.daemonId) return;
  loadingProviders.value = true;
  try {
    const res = await executeGetProviders({
      params: { daemonId: props.daemonId }
    });
    providers.value = res.value?.providers || [];
  } catch (err: any) {
    console.error("Failed to load providers:", err);
  } finally {
    loadingProviders.value = false;
  }
};

const openDialog = async () => {
  open.value = true;
  
  // Load current config
  const backupConfig = props.instanceInfo?.config?.backupConfig;
  if (backupConfig) {
    formData.enabled = backupConfig.enabled ?? false;
    formData.providerId = backupConfig.providerId ?? "";
    formData.scheduledBackup = backupConfig.scheduledBackup ?? false;
    formData.scheduleInterval = backupConfig.scheduleInterval ?? 360;
    formData.onStopBackup = backupConfig.onStopBackup ?? true;
    formData.selectedPaths = backupConfig.selectedPaths ?? [];
  }
  
  await loadProviders();
};

const submit = async () => {
  try {
    await formRef.value?.validateFields();
    await executeUpdateConfig({
      params: {
        uuid: props.instanceId ?? "",
        daemonId: props.daemonId ?? ""
      },
      data: {
        backupConfig: {
          enabled: formData.enabled,
          providerId: formData.providerId,
          scheduledBackup: formData.scheduledBackup,
          scheduleInterval: formData.scheduleInterval,
          onStopBackup: formData.onStopBackup,
          selectedPaths: formData.selectedPaths
        }
      } as any
    });
    emit("update");
    open.value = false;
    return message.success(t("TXT_CODE_d3de39b4"));
  } catch (err: any) {
    return reportErrorMsg(err.message);
  }
};

const triggerBackupNow = async () => {
  if (!props.daemonId || !props.instanceId) return;
  
  backupInProgress.value = true;
  try {
    await executeCreateBackup({
      params: {
        daemonId: props.daemonId,
        instanceUuid: props.instanceId
      },
      data: {
        selectedPaths: formData.selectedPaths.length > 0 ? formData.selectedPaths : undefined
      }
    });
    message.success(t("TXT_CODE_backup_started"));
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    backupInProgress.value = false;
  }
};

defineExpose({
  openDialog
});
</script>

<template>
  <a-modal
    v-model:open="open"
    centered
    :title="t('TXT_CODE_backup_settings')"
    :confirm-loading="isLoading"
    :ok-text="t('TXT_CODE_abfe9512')"
    :width="600"
    @ok="submit"
  >
    <div>
      <a-typography-paragraph>
        <a-typography-text type="secondary">
          {{ t("TXT_CODE_backup_settingsDescription") }}
        </a-typography-text>
      </a-typography-paragraph>

      <a-form ref="formRef" :model="formData" layout="vertical">
        <!-- Enable Backup -->
        <a-form-item>
          <a-typography-title :level="5">{{ t("TXT_CODE_backup_enableBackup") }}</a-typography-title>
          <a-switch v-model:checked="formData.enabled" />
        </a-form-item>

        <template v-if="formData.enabled">
          <!-- Provider Selection -->
          <a-form-item name="providerId" :rules="[{ required: true, message: t('TXT_CODE_backup_selectProvider') }]">
            <a-typography-title :level="5">{{ t("TXT_CODE_backup_provider") }}</a-typography-title>
            <a-select
              v-model:value="formData.providerId"
              :loading="loadingProviders"
              :placeholder="t('TXT_CODE_backup_selectProvider')"
              style="width: 100%"
            >
              <a-select-option v-for="p in providers" :key="p.id" :value="p.id">
                {{ p.name }} ({{ p.type.toUpperCase() }})
              </a-select-option>
            </a-select>
            <a-typography-text v-if="providers.length === 0 && !loadingProviders" type="warning">
              {{ t("TXT_CODE_backup_noProviders") }}
            </a-typography-text>
          </a-form-item>

          <!-- Scheduled Backup -->
          <a-form-item>
            <a-typography-title :level="5">{{ t("TXT_CODE_backup_scheduledBackup") }}</a-typography-title>
            <a-typography-paragraph>
              <a-typography-text type="secondary">
                {{ t("TXT_CODE_backup_scheduledDescription") }}
              </a-typography-text>
            </a-typography-paragraph>
            <a-space>
              <a-switch v-model:checked="formData.scheduledBackup" />
              <a-input-number
                v-if="formData.scheduledBackup"
                v-model:value="formData.scheduleInterval"
                :min="60"
                :max="10080"
                :addon-after="t('TXT_CODE_backup_minutes')"
                style="width: 180px"
              />
            </a-space>
          </a-form-item>

          <!-- On-Stop Backup -->
          <a-form-item>
            <a-typography-title :level="5">{{ t("TXT_CODE_backup_onStopBackup") }}</a-typography-title>
            <a-typography-paragraph>
              <a-typography-text type="secondary">
                {{ t("TXT_CODE_backup_onStopDescription") }}
              </a-typography-text>
            </a-typography-paragraph>
            <a-switch v-model:checked="formData.onStopBackup" />
          </a-form-item>

          <!-- Manual Backup Button -->
          <a-form-item>
            <a-typography-title :level="5">{{ t("TXT_CODE_backup_manualBackup") }}</a-typography-title>
            <a-button
              type="primary"
              :loading="backupInProgress"
              :disabled="!formData.providerId"
              @click="triggerBackupNow"
            >
              <template #icon><CloudUploadOutlined /></template>
              {{ t("TXT_CODE_backup_backupNow") }}
            </a-button>
          </a-form-item>
        </template>
      </a-form>
    </div>
  </a-modal>
</template>
