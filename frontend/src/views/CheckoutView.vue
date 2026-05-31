<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { isDark, toggleTheme } from '../theme';
import { 
  CreditCard, 
  CheckCircle2, 
  ShieldCheck, 
  AlertCircle, 
  ChevronRight, 
  Sparkles, 
  Lock, 
  User,
  Zap,
  Check,
  Sun,
  Moon
} from 'lucide-vue-next';

// Router setup to match composition API
const route = useRoute();
const router = useRouter();

// Plan definition
interface Plan {
  id: string;
  name: string;
  days: number;
  price: number;
  originalPrice?: number;
  badge?: string;
  benefits: string[];
}

const plans: Plan[] = [
  {
    id: '7',
    name: 'Acesso Bronze',
    days: 7,
    price: 30,
    benefits: [
      'Acesso total e irrestrito',
      'Liberação em segundo plano',
      'Suporte direto via Bot',
      'Sem fidelidade ou taxas'
    ]
  },
  {
    id: '14',
    name: 'Acesso Prata',
    days: 14,
    price: 50,
    originalPrice: 60,
    badge: 'Recomendado',
    benefits: [
      'Acesso total e irrestrito',
      'Liberação em segundo plano',
      'Suporte direto via Bot',
      'Desconto exclusivo incluso'
    ]
  },
  {
    id: '30',
    name: 'Acesso Ouro',
    days: 30,
    price: 100,
    originalPrice: 130,
    badge: 'Melhor Valor',
    benefits: [
      'Acesso total e irrestrito',
      'Liberação em segundo plano',
      'Suporte prioritário via Bot',
      'Máxima economia por dia'
    ]
  }
];

// Ref states
const userId = ref('');
const selectedPlanId = ref('14'); // Default best choice
const isLoading = ref(false);
const errorMessage = ref('');
const showSimulatorToggle = ref(true);
const simulateSuccess = ref(true);

onMounted(() => {
  // Capture dynamic inputs from route queries & direct window URL params as a robust failsafe
  const urlParams = new URLSearchParams(window.location.search);
  const getParam = (key: string): string => {
    return String(route.query[key] || urlParams.get(key) || '');
  };

  const initialUserId = 
    getParam('userId') || 
    getParam('userId') || 
    getParam('id') || 
    getParam('chat_id') || 
    getParam('chatId') || 
    getParam('telegramId') || 
    getParam('telegram_id');

  const initialPlano = getParam('plano') || getParam('plan');

  if (initialUserId) {
    userId.value = initialUserId;
  }

  if (initialPlano) {
    const planoStr = initialPlano;
    const matchedPlan = plans.find(p => 
      p.id === planoStr || 
      planoStr.includes(p.id) || 
      p.days.toString() === planoStr
    );
    if (matchedPlan) {
      selectedPlanId.value = matchedPlan.id;
    }
  }
});

const activePlan = computed(() => {
  return plans.find(p => p.id === selectedPlanId.value) || plans[1];
});

const selectPlan = (id: string) => {
  selectedPlanId.value = id;
};

const handleCheckout = async () => {
  errorMessage.value = '';
  
  if (!userId.value.trim()) {
    errorMessage.value = 'Por favor, informe o seu ID de Usuário do Telegram para prosseguir.';
    return;
  }

  isLoading.value = true;

  try {
    if (simulateSuccess.value) {
      // High-end simulated transition to showcase premium user journey
      await new Promise((resolve) => setTimeout(resolve, 1800));
      
      // Simulate redirection to the target /sucesso page with queries preserved
      router.push({
        path: '/sucesso',
        query: {
          userId: userId.value,
          plano: activePlan.value.id,
          simulated: 'true'
        }
      });
      return;
    }

    // Real fetch request to /api/v1/checkout as requested by the user
    const response = await fetch('/api/v1/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: userId.value,
        plano: activePlan.value.id,
      }),
    });

    if (!response.ok) {
      throw new Error(`Código de erro do servidor: ${response.status}`);
    }

    const data = await response.json();
    
    if (data && data.init_point) {
      window.location.href = data.init_point;
    } else {
      throw new Error('Endpoint invocado com sucesso, porém o link de retorno do pagamento não foi recebido.');
    }
  } catch (err: any) {
    console.error('Checkout API error:', err);
    errorMessage.value = `Não foi possível prosseguir: ${err.message || 'Erro de rede ou servidor offline.'}. Ative o "Modo Simulação" no painel abaixo para testar o fluxo visual completo.`;
  } finally {
    isLoading.value = false;
  }
};
</script>

<template>
  <div 
    id="checkout-view" 
    :class="[
      'min-h-screen flex flex-col items-center justify-center p-4 font-sans select-none antialiased relative transition-colors duration-300',
      isDark ? 'bg-neutral-950 text-neutral-100' : 'bg-neutral-50 text-neutral-900'
    ]"
  >
    
    <!-- Theme Toggle Floating Switch -->
    <div class="absolute top-4 right-4 z-40">
      <button 
        @click="toggleTheme"
        :class="[
          'p-2.5 rounded-full border transition-all cursor-pointer flex items-center justify-center shadow-sm',
          isDark 
            ? 'bg-neutral-900 border-neutral-800 text-amber-400 hover:bg-neutral-800' 
            : 'bg-white border-neutral-200 text-indigo-600 hover:bg-neutral-100'
        ]"
        title="Alternar Tema"
      >
        <Sun v-if="isDark" class="h-5 w-5" />
        <Moon v-else class="h-5 w-5" />
      </button>
    </div>

    <!-- Background Aurora Accent Glows (only on dark mode) -->
    <div v-if="isDark" class="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] h-[340px] bg-sky-500/10 rounded-full blur-[110px] pointer-events-none"></div>
    <div v-if="isDark" class="absolute bottom-10 left-1/2 -translate-x-1/2 w-[300px] h-[300px] bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none"></div>

    <div class="w-full max-w-md z-10">
      
      <!-- Loading Skeleton Screen -->
      <div 
        v-if="isLoading" 
        :class="[
          'border rounded-3xl p-6 shadow-2xl animate-fade-in transition-all',
          isDark ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-neutral-200'
        ]"
      >
        <!-- Loader Header -->
        <div class="flex flex-col items-center text-center space-y-4 mb-6">
          <div :class="['h-10 w-10 rounded-2xl flex items-center justify-center relative overflow-hidden', isDark ? 'bg-neutral-850' : 'bg-neutral-100']">
            <div :class="['absolute inset-0 bg-gradient-to-r from-transparent to-transparent animate-shimmer', isDark ? 'via-neutral-700' : 'via-neutral-200']"></div>
          </div>
          <div :class="['h-5 w-40 rounded-full relative overflow-hidden', isDark ? 'bg-neutral-850' : 'bg-neutral-200']">
            <div :class="['absolute inset-0 bg-gradient-to-r from-transparent to-transparent animate-shimmer', isDark ? 'via-neutral-700' : 'via-neutral-200']"></div>
          </div>
          <div :class="['h-3 w-56 rounded-full relative overflow-hidden', isDark ? 'bg-neutral-800/60' : 'bg-neutral-100']">
            <div :class="['absolute inset-0 bg-gradient-to-r from-transparent to-transparent animate-shimmer', isDark ? 'via-neutral-700' : 'via-neutral-200']"></div>
          </div>
        </div>

        <!-- Skeleton Form Item -->
        <div :class="['rounded-2xl p-4 border mb-4 space-y-3', isDark ? 'bg-neutral-950 border-neutral-800/80' : 'bg-neutral-50 border-neutral-200']">
          <div :class="['h-3 w-28 rounded-full', isDark ? 'bg-neutral-850' : 'bg-neutral-200']"></div>
          <div :class="['h-10 rounded-xl', isDark ? 'bg-neutral-800' : 'bg-neutral-200']"></div>
        </div>

        <!-- Skeleton Selection Card -->
        <div :class="['rounded-2xl p-4 border mb-6 space-y-3', isDark ? 'bg-neutral-950 border-neutral-800/80' : 'bg-neutral-50 border-neutral-200']">
          <div :class="['h-3 w-24 rounded-full', isDark ? 'bg-neutral-850' : 'bg-neutral-200']"></div>
          <div :class="['h-16 rounded-xl', isDark ? 'bg-neutral-800' : 'bg-neutral-200']"></div>
        </div>

        <!-- Skeleton Benefits -->
        <div class="space-y-2.5 mb-6">
          <div :class="['h-4 w-full rounded-lg', isDark ? 'bg-neutral-800' : 'bg-neutral-200']"></div>
          <div :class="['h-4 w-3/4 rounded-lg', isDark ? 'bg-neutral-800/80' : 'bg-neutral-200/80']"></div>
        </div>

        <!-- Simulated API Connecting State -->
        <div :class="['w-full rounded-xl p-3 border text-center mb-6', isDark ? 'bg-neutral-950/80 border-neutral-800' : 'bg-neutral-50 border-neutral-200']">
          <span class="text-xs text-sky-600 font-mono tracking-wide flex items-center justify-center gap-2">
            <svg class="animate-spin h-3.5 w-3.5 text-sky-600" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            Sincronizando com Gateway de Pagamento...
          </span>
        </div>

        <div :class="['h-14 rounded-2xl', isDark ? 'bg-neutral-805' : 'bg-neutral-200']"></div>
      </div>

      <!-- Main Elegant Checkout Interface -->
      <div 
        v-else 
        :class="[
          'border rounded-3xl p-6 shadow-2xl relative overflow-hidden transition-all duration-300',
          isDark ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-neutral-200 shadow-xl'
        ]"
      >
        
        <!-- Top Linear Light Ribbon -->
        <div :class="['absolute top-0 left-0 right-0 h-[2px]', isDark ? 'bg-gradient-to-r from-sky-500/20 via-sky-400 to-sky-500/20' : 'bg-sky-500']"></div>

        <!-- App Brand Header -->
        <div class="flex flex-col items-center text-center mb-6">
          <div 
            :class="[
              'h-12 w-12 rounded-2xl flex items-center justify-center border mb-3 transition-colors',
              isDark ? 'bg-sky-500/10 border-sky-400/20 text-sky-400 shadow-[0_0_15px_rgba(14,165,233,0.1)]' : 'bg-sky-50 text-sky-600 border-sky-100'
            ]"
          >
            <CreditCard class="h-6 w-6" />
          </div>
          <h1 :class="['text-xl font-bold tracking-tight mb-1', isDark ? 'text-white' : 'text-neutral-900']">Passarela de Pagamento</h1>
          <p :class="['text-[11px] max-w-[280px]', isDark ? 'text-neutral-400' : 'text-neutral-500']">Liberação de assinatura via webhook seguro no Telegram.</p>
        </div>

        <!-- User Data Input -->
        <div :class="['rounded-2xl p-4 border mb-5', isDark ? 'bg-neutral-950 border-neutral-800' : 'bg-neutral-50 border-neutral-200']">
          <label :class="['block text-[11px] font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5', isDark ? 'text-sky-400/90' : 'text-sky-600']">
            <User class="h-3.5 w-3.5" />
            Seu ID Telegram
          </label>
          <div class="relative">
            <input 
              type="text" 
              v-model="userId" 
              placeholder="Digite o seu ID do Telegram" 
              :class="[
                'w-full border rounded-xl px-4 py-3 text-sm font-semibold tracking-wide focus:outline-none transition-colors',
                isDark 
                  ? 'bg-neutral-900 border-neutral-800 focus:border-sky-500 text-white placeholder-neutral-500' 
                  : 'bg-white border-neutral-300 focus:border-sky-500 text-neutral-950 placeholder-neutral-400'
              ]"
            />
            <div v-if="userId.trim().length > 3" class="absolute right-3.5 top-3.5">
              <CheckCircle2 class="h-4 w-4 text-emerald-500" />
            </div>
          </div>
          <p :class="['text-[9px] mt-2 flex items-start gap-1', isDark ? 'text-neutral-500' : 'text-neutral-400']">
            <span>ℹ️</span> 
            <span>Seu bot de origem usa este ID numérico para aprovar seu acesso.</span>
          </p>
        </div>

        <!-- Selection Card Plans -->
        <div class="space-y-3 mb-5">
          <span :class="['block text-[11px] font-bold uppercase tracking-widest px-1', isDark ? 'text-neutral-400' : 'text-neutral-500']">Selecione o plano desejado</span>
          
          <div class="grid grid-cols-1 gap-2.5">
            <button 
              v-for="plan in plans" 
              :key="plan.id"
              @click="selectPlan(plan.id)"
              :class="[
                'w-full text-left rounded-2xl border p-4 transition-all relative overflow-hidden flex items-center justify-between cursor-pointer',
                selectedPlanId === plan.id 
                  ? (isDark ? 'border-sky-500 bg-sky-500/5 shadow-[0_4px_20px_rgba(14,165,233,0.15)]' : 'border-sky-500 bg-sky-500/5 shadow-[0_4px_15px_rgba(14,165,233,0.1)]') 
                  : (isDark ? 'border-neutral-800 hover:border-neutral-700 bg-neutral-950/40' : 'border-neutral-200 hover:border-neutral-300 bg-neutral-50')
              ]"
            >
              <!-- Promo badge overlay -->
              <span 
                v-if="plan.badge" 
                :class="[
                  'absolute right-0 top-0 text-[8px] font-extrabold px-2 py-0.5 rounded-bl-lg tracking-wider uppercase',
                  isDark ? 'bg-sky-500 text-neutral-950' : 'bg-sky-600 text-white'
                ]"
              >
                {{ plan.badge }}
              </span>

              <div class="flex items-center gap-3">
                <!-- Checkmark Selector visual -->
                <div 
                  :class="[
                    'h-5 w-5 rounded-full border flex items-center justify-center transition-colors shrink-0',
                    selectedPlanId === plan.id 
                      ? (isDark ? 'border-sky-500 bg-sky-500' : 'border-sky-500 bg-sky-500') 
                      : (isDark ? 'border-neutral-700 bg-neutral-900' : 'border-neutral-300 bg-white')
                  ]"
                >
                  <Check v-if="selectedPlanId === plan.id" :class="['h-3.5 w-3.5 stroke-[3]', isDark ? 'text-neutral-950' : 'text-white']" />
                </div>

                <div>
                  <span :class="['block text-sm font-black flex items-center gap-1.5', isDark ? 'text-neutral-100' : 'text-neutral-850']">
                    {{ plan.name }}
                  </span>
                  <span :class="['block text-[11px]', isDark ? 'text-neutral-400' : 'text-neutral-500']">Validade por {{ plan.days }} dias</span>
                </div>
              </div>

              <!-- Align Pricing Right -->
              <div class="text-right">
                <span v-if="plan.originalPrice" :class="['block text-[10px] line-through', isDark ? 'text-neutral-500' : 'text-neutral-400']">
                  R$ {{ plan.originalPrice.toFixed(2) }}
                </span>
                <span :class="['text-base font-black', isDark ? 'text-white' : 'text-neutral-900']">
                  R$ {{ plan.price }},00
                </span>
              </div>
            </button>
          </div>
        </div>

        <!-- Premium Plan Benefits Card -->
        <div :class="['rounded-2xl border p-4 mb-5', isDark ? 'bg-neutral-950/70 border-neutral-800' : 'bg-neutral-50/70 border-neutral-150']">
          <span :class="['block text-[10px] font-bold uppercase tracking-widest mb-2.5 flex items-center gap-1.5', isDark ? 'text-neutral-400' : 'text-neutral-500']">
            <Sparkles class="h-3.5 w-3.5 text-sky-500" />
            Benefícios Inclusos
          </span>
          <div :class="['grid grid-cols-2 gap-2 text-[11px]', isDark ? 'text-neutral-300' : 'text-neutral-700']">
            <div v-for="benefit in activePlan.benefits" :key="benefit" class="flex items-center gap-1.5">
              <Check class="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              <span class="truncate">{{ benefit }}</span>
            </div>
          </div>
        </div>

        <!-- Displays Backend Errors safely -->
        <div v-if="errorMessage" class="bg-red-500/10 border border-red-500/20 rounded-2xl p-3 text-xs text-red-500 mb-5 flex items-start gap-2.5">
          <AlertCircle class="h-4 w-4 shrink-0 mt-0.5" />
          <span>{{ errorMessage }}</span>
        </div>

        <!-- CTA Action Button -->
        <button 
          @click="handleCheckout"
          :class="[
            'w-full font-black text-sm py-4 rounded-2xl flex items-center justify-center gap-2 cursor-pointer transition-all',
            isDark 
              ? 'bg-sky-500 hover:bg-sky-400 text-neutral-950 shadow-[0_4px_15px_rgba(14,165,233,0.25)] hover:shadow-[0_4px_30px_rgba(14,165,233,0.4)]' 
              : 'bg-sky-600 hover:bg-sky-500 text-white shadow-[0_4px_15px_rgba(2,132,199,0.2)] hover:shadow-[0_4px_25px_rgba(2,132,199,0.35)]'
          ]"
        >
          Confirmar e Ir para o Pagamento
          <ChevronRight class="h-4 w-4 stroke-[2.5]" />
        </button>

        <!-- Dynamic Trust Indicator footer -->
        <div :class="['flex items-center justify-center gap-1.5 text-[9px] py-1.5 mt-3', isDark ? 'text-neutral-500' : 'text-neutral-400']">
          <ShieldCheck class="h-3.5 w-3.5 text-emerald-500" />
          Gateway protegido via webhook e criptografia ativa
          <Lock class="h-2.5 w-2.5" />
        </div>

      </div>

      <!-- Dev Simulator Dashboard -->
      <div v-if="showSimulatorToggle" :class="['mt-4 rounded-2xl border border-dashed p-4 text-xs', isDark ? 'bg-neutral-900/60 border-neutral-800 text-neutral-300' : 'bg-neutral-100/80 border-neutral-350 text-neutral-600']">
        <div class="flex items-center justify-between mb-2">
          <span :class="['font-bold uppercase tracking-widest flex items-center gap-1', isDark ? 'text-neutral-400' : 'text-neutral-500']">⚙️ Painel de Integração</span>
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" v-model="simulateSuccess" class="sr-only peer">
            <div class="w-9 h-5 bg-neutral-300 dark:bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-neutral-100 after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-500"></div>
            <span :class="['ml-2 font-bold uppercase tracking-wider text-[10px]', isDark ? 'text-neutral-400' : 'text-neutral-500']">Simular</span>
          </label>
        </div>
        <p class="text-[10px] text-neutral-500 leading-normal">
          O modo de simulação permite que você verifique todo o roteamento de sucesso e fluxo de UI visual sem a necessidade de chaves de API prontas de produção.
        </p>
      </div>

    </div>

  </div>
</template>

<style scoped>
@keyframes shimmer {
  0% { transform: translateX(-150%); }
  50% { transform: translateX(-50%); }
  100% { transform: translateX(150%); }
}

.animate-shimmer {
  animation: shimmer 1.8s infinite ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.97); }
  to { opacity: 1; transform: scale(1); }
}

.animate-fade-in {
  animation: fadeIn 0.4s ease-out forwards;
}
</style>
