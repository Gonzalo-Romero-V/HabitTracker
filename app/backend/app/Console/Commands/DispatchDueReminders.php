<?php

namespace App\Console\Commands;

use App\Models\Habit;
use App\Models\Reminder;
use App\Services\Push\PushSender;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Kreait\Firebase\Exception\Messaging\NotFound;
use Throwable;

/**
 * Despacha recordatorios vencidos — ver domain/reminder.md. Pensado para
 * correr cada minuto vía el Scheduler: compara `time_of_day` contra la
 * hora actual exacta (HH:mm) en el timezone de cada usuario.
 */
class DispatchDueReminders extends Command
{
    protected $signature = 'habits:dispatch-due-reminders';

    protected $description = 'Despacha push a los recordatorios cuyo time_of_day coincide con la hora actual del usuario';

    public function handle(PushSender $sender): int
    {
        $dispatched = 0;

        Reminder::query()
            ->whereHas('habit', fn ($q) => $q->where('status', 'active'))
            // Solo los logs recientes (la semana en curso cabe en 8 días
            // hacia atrás, y los `pending` futuros ya materializados no
            // estorban) — antes se cargaba el historial completo de cada
            // hábito en cada corrida por minuto.
            ->with([
                'habit.user.deviceTokens',
                'habit.logs' => fn ($q) => $q->where('occurrence_date', '>=', now()->subDays(8)->toDateString()),
                'habit.quotaVersions',
            ])
            ->chunkById(200, function ($reminders) use ($sender, &$dispatched) {
                foreach ($reminders as $reminder) {
                    if (! $this->isDue($reminder) || ! $this->habitStillNeedsIt($reminder->habit)) {
                        continue;
                    }

                    foreach ($reminder->habit->user->deviceTokens as $deviceToken) {
                        // Un token roto (desinstalado, expirado, etc.) no debe frenar el
                        // despacho al resto de dispositivos/usuarios de esta corrida.
                        try {
                            $sender->send(
                                $deviceToken,
                                'Recordatorio: '.$reminder->habit->name,
                                'No olvides completar tu hábito hoy.',
                            );
                            $dispatched++;
                        } catch (NotFound $e) {
                            // FCM responde "no registrado": el token murió
                            // (app desinstalada, token rotado). Se elimina en
                            // vez de reintentarlo para siempre (domain/
                            // device-token.md → Reglas de negocio).
                            Log::info('Token de push no registrado, eliminado', ['device_token_id' => $deviceToken->id]);
                            $deviceToken->delete();

                            continue;
                        } catch (Throwable $e) {
                            Log::warning('Fallo al despachar push de recordatorio', [
                                'device_token_id' => $deviceToken->id,
                                'reminder_id' => $reminder->id,
                                'error' => $e->getMessage(),
                            ]);

                            continue;
                        }
                    }
                }
            });

        $this->info("Notificaciones despachadas: {$dispatched}.");

        return self::SUCCESS;
    }

    private function isDue(Reminder $reminder): bool
    {
        $now = CarbonImmutable::now($reminder->habit->user->timezone);

        return $now->format('H:i') === substr((string) $reminder->time_of_day, 0, 5);
    }

    /**
     * `fixed`: solo si hoy es una ocurrencia programada (existe un
     * HabitLog) y todavía no se completó. `quota`: solo si el período en
     * curso no alcanzó `quota_target` todavía (ver domain/reminder.md).
     */
    private function habitStillNeedsIt(Habit $habit): bool
    {
        $timezone = $habit->user->timezone;
        $today = CarbonImmutable::now($timezone)->toDateString();

        if ($habit->recurrence_type === 'fixed') {
            $log = $habit->logs->first(fn ($l) => $l->occurrence_date->toDateString() === $today);

            return $log !== null && $log->status === 'pending';
        }

        $target = $habit->quotaVersionEffectiveOn($today)?->quota_target;
        if ($target === null) {
            return false;
        }

        $weekStart = CarbonImmutable::now($timezone)->startOfWeek(CarbonImmutable::MONDAY)->toDateString();
        $weekEnd = CarbonImmutable::now($timezone)->endOfWeek(CarbonImmutable::SUNDAY)->toDateString();

        $completedThisWeek = $habit->logs
            ->filter(fn ($l) => $l->status === 'completed'
                && $l->occurrence_date->toDateString() >= $weekStart
                && $l->occurrence_date->toDateString() <= $weekEnd)
            ->count();

        return $completedThisWeek < $target;
    }
}
