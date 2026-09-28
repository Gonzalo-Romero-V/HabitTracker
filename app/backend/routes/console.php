<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Ver decisions/architecture.md → Jobs. Todos son idempotentes y se
// recuperan solos si el servidor estuvo apagado. materialize-month corre
// cada hora (no una vez al día): el servidor es una máquina que no está
// encendida 24/7, y un único horario fijo podía perderse justo el último
// día o el día 1 del mes. withoutOverlapping evita que una corrida lenta
// se solape con la siguiente.
Schedule::command('habits:materialize-month')->hourly()->withoutOverlapping();
Schedule::command('habits:evaluate-closures')->everyThirtyMinutes()->withoutOverlapping();
Schedule::command('habits:dispatch-due-reminders')->everyMinute()->withoutOverlapping();
