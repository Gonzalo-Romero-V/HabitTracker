<?php

use App\Http\Middleware\SyncClientTimezone;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'sync.timezone' => SyncClientTimezone::class,
        ]);

        // API pura: un invitado nunca se redirige. Sin esto, un request sin
        // `Accept: application/json` intentaba redirigir a route('login')
        // (inexistente) y terminaba en 500 en vez del 401 del contrato.
        $middleware->redirectGuestsTo(fn () => null);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // El orden importa: las específicas van antes del catch-all
        // genérico de \Throwable al final.
        $exceptions->render(function (ValidationException $e, Request $request) {
            if ($request->is('api/*')) {
                $fields = $e->errors();
                $firstMessage = array_values($fields)[0][0] ?? 'Los datos enviados no son válidos.';

                return response()->json([
                    'error' => [
                        'code' => 'VALIDATION_ERROR',
                        'mensaje' => $firstMessage,
                        'fields' => $fields,
                    ],
                ], 422);
            }
        });

        $exceptions->render(function (AuthenticationException $e, Request $request) {
            if ($request->is('api/*')) {
                return response()->json([
                    'error' => [
                        'code' => 'UNAUTHENTICATED',
                        'mensaje' => 'Debes iniciar sesión para continuar.',
                    ],
                ], 401);
            }
        });

        // Nota: Laravel convierte internamente AuthorizationException en
        // AccessDeniedHttpException (Handler::prepareException()) antes de
        // llegar a los render() registrados acá — hay que capturar el tipo
        // Symfony, no el de Illuminate, o el callback nunca hace match y
        // el error cae silenciosamente al catch-all genérico de abajo.
        $exceptions->render(function (AuthorizationException|AccessDeniedHttpException $e, Request $request) {
            if ($request->is('api/*')) {
                return response()->json([
                    'error' => [
                        'code' => 'FORBIDDEN',
                        'mensaje' => 'No tienes permiso para realizar esta acción.',
                    ],
                ], 403);
            }
        });

        $exceptions->render(function (ModelNotFoundException|NotFoundHttpException $e, Request $request) {
            if ($request->is('api/*')) {
                return response()->json([
                    'error' => [
                        'code' => 'NOT_FOUND',
                        'mensaje' => 'El recurso solicitado no existe.',
                    ],
                ], 404);
            }
        });

        // Catch-all: cualquier error no esperado se loguea server-side y
        // devuelve un 500 genérico sin detalle interno (ver architecture.md
        // → Manejo de errores). Debe ser el último `render` registrado.
        $exceptions->render(function (\Throwable $e, Request $request) {
            if ($request->is('api/*')) {
                report($e);

                return response()->json([
                    'error' => [
                        'code' => 'SERVER_ERROR',
                        'mensaje' => 'Ocurrió un error inesperado. Intenta de nuevo.',
                    ],
                ], 500);
            }
        });
    })->create();
