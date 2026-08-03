<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from '@/i18n/useI18n';

const props = defineProps<{
  title: string;
  initialValue: string;
}>();

const emit = defineEmits<{
  (e: 'confirm', value: string): void;
  (e: 'cancel'): void;
}>();

const { t } = useI18n();

const input = ref<HTMLInputElement | null>(null);
const value = ref(props.initialValue);

onMounted(() => {
  input.value?.focus();
  input.value?.select();
});

function confirm() {
  if (value.value.trim()) {
    emit('confirm', value.value.trim());
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
    <div class="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
      <h3 class="mb-4 text-sm font-semibold text-slate-200">{{ title }}</h3>
      
      <input
        ref="input"
        v-model="value"
        type="text"
        class="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
        @keyup.enter="confirm"
        @keyup.escape="emit('cancel')"
      />
      
      <div class="mt-5 flex justify-end gap-3">
        <button
          class="rounded-md px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200"
          @click="emit('cancel')"
        >
          {{ t('prompt.cancel') }}
        </button>
        <button
          class="rounded-md bg-violet-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
          @click="confirm"
        >
          {{ t('prompt.save') }}
        </button>
      </div>
    </div>
  </div>
</template>
