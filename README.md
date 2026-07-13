# Mercado Mónaco — MVP

Sistema de gestión de inventario y ventas offline-first para un solo usuario (Yamile), dueña de un pequeño mercado. El principal objetivo de la aplicación es permitir llevar un control preciso de las ventas diarias desglosadas por método de pago (**efectivo vs. transferencia**) y calcular la utilidad real del negocio en tiempo real.

Este proyecto está construido como una aplicación móvil offline-first que almacena todos sus datos localmente en una base de datos SQLite.

---

## 🛠️ Stack Tecnológico

La aplicación utiliza las siguientes tecnologías y librerías clave:

- **Framework**: [Expo SDK 54](https://expo.dev/) (con [Expo Router v6](https://docs.expo.dev/router/introduction/) para enrutamiento basado en archivos).
- **Lenguaje**: [TypeScript](https://www.typescriptlang.org/) (modo estricto).
- **Base de Datos**: [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/) gestionado con [Drizzle ORM](https://orm.drizzle.team/) para un acceso seguro y tipado.
- **Estilos**: [uniwind](https://github.com/uniwind/uniwind) (Tailwind CSS v4 adaptado para React Native).
- **Gestión de Estado**: [Zustand](https://github.com/pmndrs/zustand) (utilizado para el carrito de compras y estado transitorio de la sesión de venta).
- **Formularios y Validación**: [react-hook-form](https://react-hook-form.com/) junto con [Zod](https://zod.dev/) para esquemas de validación de datos.
- **Teclado**: [react-native-keyboard-controller](https://kirillzyusko.github.io/react-native-keyboard-controller/) para un comportamiento fluido y adaptativo de las pantallas con formularios.
- **Animaciones**: [react-native-reanimated](https://docs.swmansion.com/react-native-reanimated/) para transiciones y animaciones fluidas.
- **Fechas**: [date-fns](https://date-fns.org/) para el manejo y formateo de fechas con localización en español (`es`).

---

## ⚙️ Requisitos Previos

Asegúrate de tener instalado en tu entorno de desarrollo:

- **Node.js**: `^18.18.0` o superior (se recomienda `^20`).
- **pnpm**: `^9.0.0` o superior para la gestión de dependencias.
- **Android SDK / Xcode**: Para emulación o desarrollo en dispositivos físicos.
  - *Nota*: Ciertas funcionalidades como las notificaciones locales requieren una *development build* en dispositivo real Android/iOS, ya que no son 100% compatibles con Expo Go convencional.

---

## 🚀 Instalación y Configuración

Sigue estos pasos para levantar el entorno local:

1. **Instalar dependencias**:
   ```bash
   pnpm install
   ```

2. **Iniciar el servidor de desarrollo de Expo**:
   ```bash
   pnpm start
   ```

3. **Ejecutar en emulador o dispositivo**:
   - Presiona `a` para abrir en un emulador Android (o ejecuta `pnpm android`).
   - Presiona `i` para abrir en un simulador iOS (o ejecuta `pnpm ios`).
   - Escanea el código QR desde la consola utilizando la aplicación Expo Go o tu build de desarrollo correspondiente.

---

## 🗄️ Base de Datos e Infraestructura Drizzle

La base de datos local SQLite (`db.sqlite`) se gestiona mediante el **patrón repositorio** en la carpeta `db/`.

### Convenciones del Código de Base de Datos
- **Repositores específicos**:
  - [db/products.ts](file:///media/ergo/047E4AB87E4AA1F246/VS_Code_Projects/sales_manager/wt-tsk-17-18-19/db/products.ts) — Productos y catálogo.
  - [db/sales.ts](file:///media/ergo/047E4AB87E4AA1F246/VS_Code_Projects/sales_manager/wt-tsk-17-18-19/db/sales.ts) — Transacciones de venta y sesiones.
  - [db/movements.ts](file:///media/ergo/047E4AB87E4AA1F246/VS_Code_Projects/sales_manager/wt-tsk-17-18-19/db/movements.ts) — Movimientos de almacén (entradas, retiros, mermas, ajustes).
  - [db/expenses.ts](file:///media/ergo/047E4AB87E4AA1F246/VS_Code_Projects/sales_manager/wt-tsk-17-18-19/db/expenses.ts) — Gastos operativos (ONAT, salarios, multas, rebajas por liquidación).
  - [db/queries.ts](file:///media/ergo/047E4AB87E4AA1F246/VS_Code_Projects/sales_manager/wt-tsk-17-18-19/db/queries.ts) — Consultas complejas y reportes financieros agregados.
  - [db/config.ts](file:///media/ergo/047E4AB87E4AA1F246/VS_Code_Projects/sales_manager/wt-tsk-17-18-19/db/config.ts) — Configuración del sistema.
- **Escrituras seguras**: Todas las escrituras en la base de datos realizadas desde la UI deben estar envueltas en el helper `safeWrite` importado de `@/lib/safe-write` para garantizar el manejo de errores unificado.

### Migraciones de Base de Datos
Las migraciones se ejecutan de manera automática al inicializar la aplicación utilizando el hook `useMigrations` en `app/_layout.tsx`.

Si realizas cambios en el esquema de la base de datos en [db/schema.ts](file:///media/ergo/047E4AB87E4AA1F246/VS_Code_Projects/sales_manager/wt-tsk-17-18-19/db/schema.ts), debes generar una nueva migración ejecutando:

```bash
npx drizzle-kit generate
```

Esto generará un archivo SQL correspondiente dentro del directorio `drizzle/`.

---

## 🎨 Temas y Estilos

La aplicación cuenta con una paleta de colores coherente y soporta personalización mediante constantes semánticas definidas en `constants/theme`.
- Se recomienda el uso del hook `useAppColors` (`hooks/use-app-colors`) para acceder dinámicamente a los colores del tema en componentes y layouts.

---

## 📚 Enlaces de Interés y Documentación

- **Índice de Documentación Técnica**: Revisa [docs/README.md](file:///media/ergo/047E4AB87E4AA1F246/VS_Code_Projects/sales_manager/wt-tsk-17-18-19/docs/README.md) para un listado detallado de análisis, deuda técnica y especificaciones de mejora.
- **Seguimiento del Proyecto (Notion)**: Las tareas y el roadmap activo se gestionan y monitorizan en nuestro [Tablero de Notion › Mercado Mónaco MVP](https://app.notion.com/p/39a19c33c39081fab767c40eb46cc347).
- **Roadmap MVP Histórico**: El listado de tareas inicial y su estado de compleción se puede revisar en [ROADMAP.md](file:///media/ergo/047E4AB87E4AA1F246/VS_Code_Projects/sales_manager/wt-tsk-17-18-19/ROADMAP.md).
