<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('habits', function (Blueprint $table) {
            // Vigencia del hábito — opcional, default `indefinite` (la
            // definición tradicional de hábito es cíclica/sin fin, pero en
            // la práctica muchos hábitos tienen una fecha de término
            // conocida de antemano, ej. "tomar este antibiótico" o "entrenar
            // para la maratón de noviembre"). Solo uno de los dos campos
            // siguientes aplica según `duration_type` (mismo patrón que
            // recurrence_rule vs. quota_target en este mismo modelo).
            $table->enum('duration_type', ['indefinite', 'end_date', 'duration_days'])
                ->default('indefinite')
                ->after('recurrence_rule');
            $table->date('duration_end_date')->nullable()->after('duration_type');
            $table->unsignedInteger('duration_days')->nullable()->after('duration_end_date');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('habits', function (Blueprint $table) {
            $table->dropColumn(['duration_type', 'duration_end_date', 'duration_days']);
        });
    }
};
