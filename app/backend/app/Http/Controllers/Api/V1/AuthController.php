<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\GoogleLoginRequest;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Auth\RegisterRequest;
use App\Http\Requests\Auth\UpdateUserRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use Google\Client as GoogleClient;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function register(RegisterRequest $request)
    {
        $user = User::create([
            'name' => $request->validated('name'),
            'email' => $request->validated('email'),
            'password' => $request->validated('password'),
            'timezone' => $request->validated('timezone'),
        ]);

        return response()->json([
            'data' => [
                'user' => new UserResource($user),
                'token' => $user->createToken($request->userAgent() ?? 'api')->plainTextToken,
            ],
            'mensaje' => 'Cuenta creada correctamente.',
        ], 201);
    }

    public function login(LoginRequest $request)
    {
        $user = User::where('email', $request->validated('email'))->first();

        if (! $user || ! $user->password || ! Hash::check($request->validated('password'), $user->password)) {
            throw ValidationException::withMessages([
                'email' => ['Las credenciales no coinciden con nuestros registros.'],
            ]);
        }

        return response()->json([
            'data' => [
                'user' => new UserResource($user),
                'token' => $user->createToken($request->userAgent() ?? 'api')->plainTextToken,
            ],
            'mensaje' => 'Sesión iniciada correctamente.',
        ]);
    }

    public function google(GoogleLoginRequest $request)
    {
        // Sin 'client_id' en el constructor: la librería solo chequea aud si
        // se le pasa un client_id (ver vendor/google/apiclient/src/AccessToken/
        // Verify.php), y acepta un único string, no una lista. Como el
        // frontend web y el nativo Android emiten tokens con audiencias
        // distintas (dos proyectos GCP distintos, ver services.php), el
        // chequeo de aud se hace a mano contra ambos valores permitidos —
        // mismo patrón que documenta Google para "multiple client IDs"
        // (https://developers.google.com/identity/sign-in/android/backend-auth).
        $client = new GoogleClient();

        try {
            $payload = $client->verifyIdToken($request->validated('id_token'));
        } catch (\Throwable $e) {
            // El SDK de Google lanza excepción (no devuelve false) ante un
            // token malformado/expirado/no verificable — se homologa al
            // mismo 422 de abajo. Se loguea la causa real (ej. errores de
            // red/SSL al pedir las claves públicas de Google) para poder
            // diagnosticar sin exponer detalle interno al cliente.
            Log::warning('Fallo al verificar id_token de Google', [
                'exception' => get_class($e),
                'message' => $e->getMessage(),
            ]);
            $payload = false;
        }

        $allowedClientIds = array_filter([
            config('services.google.client_id'),
            config('services.google.client_id_android'),
        ]);

        // email_verified es obligatorio: la vinculación automática por email
        // (domain/user.md) se apoya en que Google ya verificó ese correo.
        if (
            ! $payload
            || ! in_array($payload['aud'] ?? null, $allowedClientIds, true)
            || ! filter_var($payload['email_verified'] ?? false, FILTER_VALIDATE_BOOLEAN)
        ) {
            throw ValidationException::withMessages([
                'id_token' => ['El token de Google no es válido.'],
            ]);
        }

        $user = User::where('google_id', $payload['sub'])->first();

        if (! $user) {
            $user = User::where('email', $payload['email'])->first();

            if ($user) {
                // Cuenta ya existente con ese correo (registrada con password) —
                // se vincula automáticamente: Google ya verificó el email.
                $user->update(['google_id' => $payload['sub']]);
            } else {
                $user = User::create([
                    'name' => $payload['name'],
                    'email' => $payload['email'],
                    'google_id' => $payload['sub'],
                    'password' => null,
                    'timezone' => $request->validated('timezone'),
                ]);
            }
        }

        return response()->json([
            'data' => [
                'user' => new UserResource($user),
                'token' => $user->createToken($request->userAgent() ?? 'api')->plainTextToken,
            ],
            'mensaje' => 'Sesión iniciada correctamente.',
        ]);
    }

    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json([
            'data' => null,
            'mensaje' => 'Sesión cerrada correctamente.',
        ]);
    }

    public function me(Request $request)
    {
        return response()->json([
            'data' => new UserResource($request->user()),
        ]);
    }

    public function updateMe(UpdateUserRequest $request)
    {
        $request->user()->update($request->validated());

        return (new UserResource($request->user()))
            ->additional(['mensaje' => 'Perfil actualizado correctamente.'])
            ->response();
    }
}
