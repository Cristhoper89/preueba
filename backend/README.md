# Café Aurora — Landing Page, Panel y Backend

Proyecto organizado en tres carpetas: `lading-page` contiene la interfaz comercial, `control-marketing` contiene el panel interno y `backend` contiene el servidor, acceso a PostgreSQL y scripts. Ambos módulos web consumen el mismo backend. Las solicitudes registradas no generan cobros ni órdenes de envío.

## Requisitos
- Node.js 20 o superior
- PostgreSQL instalado y ejecutándose localmente
- pgAdmin (opcional, para administrar la base de datos)

## Instalación

1. Crear la base de datos `cafe_aurora` en PostgreSQL (puede hacerse desde pgAdmin).
2. Ejecutar `backend/schema.sql` sobre esa base de datos.
3. Copiar `backend/.env.example` a `backend/.env` y configurar `DATABASE_URL` con el usuario y contraseña locales.
4. Instalar dependencias e iniciar el servidor desde `backend`:

```powershell
Set-Location .\backend
npm install
npm start
```

5. Abrir la landing en `http://localhost:3000` o el panel en `http://localhost:3000/marketing/`.
Si el servidor ya estaba ejecutándose antes de incorporar el panel, reinícialo para que cargue las nuevas rutas.

## Docker

El proyecto incluye un Dockerfile para cada carpeta y un `docker-compose.yml` para iniciar los tres servicios:

1. Copiar `backend/.env.example` a `backend/.env` y configurar `DATABASE_URL`. Desde un contenedor, `localhost` apunta al propio contenedor; usa una dirección de PostgreSQL accesible desde Docker.
2. Crear la base de datos y ejecutar `backend/schema.sql` sobre ella.
3. Desde la raíz del proyecto, ejecutar:

```powershell
docker compose up --build
```

La landing queda disponible en `http://localhost:8081`, el panel en `http://localhost:8080` y el backend en `http://localhost:3000`. Las interfaces web envían sus solicitudes `/api/` al servicio `backend` de Compose. La imagen `backend/Dockerfile` ejecuta únicamente la API; no incluye ni sirve los archivos de la landing o del panel. Para publicar solo la API en Coolify, configura el puerto `3000`.

Cada frontend reenvía `/api/` al dominio HTTPS público del backend, por lo que las solicitudes de la aplicación y las cookies de sesión permanecen en el mismo origen del navegador. La API permite por defecto los orígenes HTTP y HTTPS actuales de la landing y del panel. Si defines `CORS_ALLOWED_ORIGINS` en Coolify, los valores válidos se agregan a los permitidos predeterminados; usa hosts o URLs HTTP(S) separados por comas. Las entradas inválidas se advierten en los logs y no detienen el backend. La verificación TLS del backend está activada en Nginx. Configura certificados HTTPS válidos en ambos dominios frontend en Coolify; las cookies de sesión son `Secure` en producción y no funcionarán desde páginas servidas por HTTP.

### Coolify

Los Dockerfiles usan rutas relativas a la raíz del repositorio. Al crear cada servicio Dockerfile en Coolify, configura el **Base Directory / Build Context** como `/` y la ruta del Dockerfile según el servicio:

- Backend: `/backend/Dockerfile`
- Panel: `/control-marketing/Dockerfile`
- Landing: `/lading-page/Dockerfile`

La carpeta de la landing se llama `lading-page` en este repositorio. Si se despliega con Docker Compose, usa el `docker-compose.yml` de la raíz, que ya define el contexto raíz para cada servicio. El `.dockerignore` raíz excluye dependencias y archivos `.env`, pero no excluye las carpetas de la aplicación.

### Cuentas de clientes

Al crear una cuenta se solicitan nombre, correo, contraseña, teléfono, ciudad y dirección de entrega; estos últimos datos quedan guardados en el perfil y se reutilizan al iniciar sesión. Las contraseñas deben tener al menos 12 caracteres y se almacenan con `scrypt`; las sesiones usan cookies `HttpOnly` y registros de sesión en PostgreSQL. Las suscripciones y los leads capturados por una cuenta quedan relacionados mediante `user_id`. Antes de registrar un lead, el backend normaliza el correo y consulta PostgreSQL; si encuentra una suscripción con estado `simulada`, `activa` o `active`, no guarda el lead, incluso si la suscripción no tiene asociado un `user_id`. Las suscripciones canceladas, vencidas o inactivas no se consideran activas.

### Preparar acceso al panel

El comando crea o actualiza las tablas necesarias desde `schema.sql` y luego crea o restablece el administrador. La base de datos debe existir, estar activa y el usuario configurado en `DATABASE_URL` debe tener permisos para crear tablas e índices. La contraseña debe tener al menos 12 caracteres:

```powershell
$env:ADMIN_EMAIL = "admin@cafeaurora.local"
$env:ADMIN_PASSWORD = "elige-una-clave-segura"
$env:ADMIN_ROLE = "admin"
npm run admin:create
```

Ejecuta el comando desde la carpeta `backend`. Los roles disponibles son `admin`, `analyst` y `sales`. Administradores pueden consultar y exportar todas las secciones; analistas consultan dashboard, campañas y eventos; el equipo comercial consulta leads y suscripciones. La creación y restablecimiento de usuarios se realiza desde este comando, no desde el panel.

El panel usa sesiones aleatorias persistidas como hash en PostgreSQL, cookies `HttpOnly`/`SameSite=Strict`, contraseñas con `scrypt`, limitación básica de intentos y auditoría de accesos/consultas. En producción, configurar HTTPS y `NODE_ENV=production` para activar cookies `Secure`.

## Funcionalidades
- Landing responsive con propuesta de valor, beneficios, proceso en tres pasos, tres planes y preguntas frecuentes.
- Flujo de suscripción: selección de plan, tamaño, frecuencia, resumen, datos de contacto y confirmación.
- Registro e inicio de sesión con correo y contraseña; el teléfono y la dirección se guardan al crear la cuenta y se reutilizan en suscripciones posteriores, asociadas mediante `user_id`.
- Los precios se calculan y validan en el servidor. El formulario no solicita información de tarjetas.
- Captura opcional de correo mediante modal de intención de salida, con consentimiento.
- Tracking propio en PostgreSQL: `page_view`, `plan_selected`, `checkout_started`, `checkout_abandoned`, `subscription_confirmed`, `subscription_updated`, `subscription_cancelled` y `lead_captured`. Las actualizaciones y cancelaciones se registran desde el backend en la misma transacción del cambio de suscripción.
- Captura de UTM y de origen básico (`gclid` / `fbclid`) sin cargar píxeles publicitarios.
- Panel de marketing en `../control-marketing`, protegido por autenticación y con dashboard, campañas, leads, eventos, suscripciones y exportaciones CSV.
- La migración de `schema.sql` agrega usuarios, roles, sesiones, auditoría e índices del panel. Puede ejecutarse de nuevo de forma segura para actualizar una base existente.

## Tablas
- `subscriptions`: solicitudes de suscripción.
- `leads`: correos capturados con consentimiento y, cuando existe una sesión autenticada, asociados mediante `user_id`.
- `events`: eventos de navegación y conversión.
- `users` y `user_sessions`: cuentas de clientes y sesiones autenticadas.
- `marketing_admin_users`, `marketing_roles`, `marketing_admin_sessions` y `marketing_admin_audit`: acceso, roles, sesiones y auditoría del panel.

## Consultas útiles para revisar métricas

```sql
-- Eventos por tipo
SELECT event_name, COUNT(*) AS total
FROM events
GROUP BY event_name
ORDER BY total DESC;

-- Suscripciones por campaña
SELECT COALESCE(campaign, 'sin campaña') AS campaign, COUNT(*) AS subscriptions
FROM subscriptions
GROUP BY campaign
ORDER BY subscriptions DESC;

-- Registros recientes
SELECT id, customer_name, email, plan_name, price_cop, status, created_at
FROM subscriptions
ORDER BY created_at DESC;
```

## Notas antes de producción
- Los valores, marca, testimonios implícitos y condiciones comerciales son ficticios; validar oferta, precios, logística, términos y política de tratamiento de datos antes de publicar.
- Las imágenes y tipografías se cargan desde Unsplash y Google Fonts; el resto de la aplicación corre localmente. Para operación totalmente offline, descargar y servir esos recursos localmente.
- Añadir HTTPS, protección anti-spam/rate limiting, gestión de consentimiento y política de privacidad antes de una campaña real.
- Los visitantes se estiman con sesiones del navegador, no como personas únicas. La conversión de leads se calcula por `user_id`, no por coincidencia de correo.
- El panel no presenta CAC ni LTV: no se registran inversión publicitaria ni ingresos reales.
- Los datos de campañas previos a esta ampliación no tendrán `gclid`/`fbclid` retroactivamente; los nuevos registros sí los conservarán cuando estén presentes.
- No se ha conectado una pasarela de pago; el sitio no procesa pagos reales.
