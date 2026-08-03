import { computed } from 'vue';
import { useStudio } from '@/stores/studio';
import { t as translate, type Language } from './translations';

export function useI18n() {
  const studio = useStudio();

  const language = computed(() => (studio.config?.language ?? 'en') as Language);

  const t = (key: string): string => translate(key, language.value);

  return { t, language };
}
