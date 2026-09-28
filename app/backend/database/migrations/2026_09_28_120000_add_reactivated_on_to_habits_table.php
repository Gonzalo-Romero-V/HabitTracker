<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('habits', function (Blueprint $table) {
            // Fecha (timezone del usuario) de la última reactivación de un
            // hábito archivado. El hueco archivado es neutro (no genera
            // ocurrencias ni `missed`), pero no es modo vacaciones (fuera de
            // alcance, ver intent/vision.md): StreakService reinicia
            // current_streak a 0 en esta fecha; best_streak se conserva.
            $table->date('reactivated_on')->nullable()->after('duration_days');
        });
    }

    public function down(): void
    {
        Schema::table('habits', function (Blueprint $table) {
            $table->dropColumn('reactivated_on');
        });
    }
};
