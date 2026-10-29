# Finanzas en pareja

Simulador mensual de ingresos, gastos, deudas y reglas de reparto para dos personas. Permite comparar cuánto dinero queda disponible para cada integrante y para el hogar.

## Usar en el navegador

[Abrir el simulador](https://yayop.github.io/finanzas/). No requiere instalar Python ni crear una cuenta. Siempre comienza con un plan vacío.

El cálculo se ejecuta en el navegador con los mismos módulos Python de la versión local, mediante [Pyodide](https://pyodide.org/en/stable/). La primera carga descarga el motor desde jsDelivr y requiere conexión a Internet. Los importes y planes introducidos no se envían al servidor.

Cada navegador conserva su propia copia. Para pasar un plan a otro computador, usar «Exportar» e «Importar».

## Usar en el equipo local

Requiere Python 3.9 o posterior, sin dependencias adicionales:

```sh
python3 scripts/servidor.py
```

Abrir [http://127.0.0.1:8765/](http://127.0.0.1:8765/). En macOS también se puede abrir `iniciar.command` con doble clic. Para otro puerto:

```sh
python3 scripts/servidor.py --port 8766
```

## Funcionamiento

Cada apertura comienza con un plan vacío, saldos en cero y sin movimientos. «Vaciar» vuelve a ese estado. «Recuperar» carga el último plan guardado en ese navegador.

- Nombres editables para ambas personas.
- Ingresos, gastos y deudas con conceptos libres en EUR o CLP.
- Pagos únicos, recurrencias cada uno a doce meses y planes de cuotas.
- Fechas de inicio y término, cuotas totales y cuotas ya pagadas.
- Responsabilidad personal o compartida, independiente de quién realiza el pago.
- Gastos compartidos según una regla general o porcentajes propios por movimiento.
- Reparto 50/50, proporcional a ingresos, proporcional tras compromisos, igualdad de margen o porcentaje manual.
- Inclusión opcional de ingresos extra en el cálculo del reparto.
- Proyecciones de hasta 60 meses, gráficos, saldos y compensaciones entre ambas personas.
- Compromisos posteriores al período proyectado.
- Pestaña Operativa con cuentas individuales o comunes, moneda, saldos y transferencias planificadas.
- Comisión fija en EUR por cada transferencia entre monedas, cargada en la cuenta de origen.
- Asignación de cada ingreso o pago a una cuenta y calendario de caja con saldos mínimos.
- Pestaña Ajustes con sliders del reparto de cada gasto compartido.
- Grupos, etiquetas y marcas de gastos en el gráfico, con series mensuales o acumuladas.
- Referencia para comparar cambios, exportación e importación de planes JSON.

Los nombres iniciales son Yayo y Fer y pueden cambiarse en «Nombres». Por ejemplo, un gasto compartido de 100 EUR con un reparto 25/75 asigna 25 EUR a la primera persona y 75 EUR a la segunda, aunque cualquiera de las dos realice el pago. Bajo «Igualar margen», la compensación general puede redistribuir indirectamente el efecto de ese reparto.

En cuotas, la fecha corresponde a la próxima cuota pendiente. Se puede introducir el total original a dividir entre todas las cuotas o el importe fijo de cada cuota. Las cuotas ya pagadas no vuelven a cobrarse. No se infieren capital pendiente ni intereses a partir de una cuota.

## Datos y almacenamiento

Los cambios válidos y la referencia se guardan en el almacenamiento local del navegador. Abrir o vaciar la pantalla no sobrescribe la copia anterior. Los planes no se sincronizan automáticamente entre computadores; se pueden transferir mediante «Exportar» e «Importar», conservando también su referencia de comparación.

El servidor local escucha únicamente en el propio equipo y no guarda los datos recibidos en archivos. Los archivos personales pueden conservarse en `datos/`, excluido de Git. También se excluyen resultados locales, credenciales y artefactos de `outputs/`.

Los planes de la versión anterior se convierten al formato de movimientos conservando importes, fechas y repartos. Los gastos antes compartidos al 100 % pasan a «Compartido»; los personales parcialmente compartidos conservan su porcentaje. La copia anterior del navegador se mantiene.

## Alcance del cálculo

Los resultados son mensuales y previos a reservar ahorro. Los movimientos conservan su moneda original y se presentan en EUR, usando un tipo de cambio constante editable y sin comisiones. Los saldos iniciales se introducen en EUR.

La pestaña Operativa calcula la caja por cuenta en las fechas registradas. Si coinciden pagos e ingresos en una fecha, considera primero las salidas para mostrar un mínimo conservador; no conoce las horas bancarias. Las transferencias son planificación y no se ejecutan. El modelo no conecta con bancos ni calcula derechos o importes legales de prestaciones. Un saldo negativo indica dinero por cubrir; no genera un crédito automático.

## Cuentas y perspectivas

Los saldos iniciales de las cuentas se suman al «Saldo sin cuenta» de cada persona. No se debe registrar el mismo dinero en ambos lugares. Las cuentas comunes atribuyen su saldo según el porcentaje configurado. Cada movimiento conserva quién asume su costo, quién paga y desde qué cuenta sale o entra el dinero.

«Por reparto» muestra el costo asumido; «Por pagos» muestra los pagos atribuidos a cada persona; en las cuentas comunes se usa su porcentaje. Los pagos de uno reducen su aporte pendiente en los demás. La compensación pendiente es acumulada y compara el acuerdo con la posición real por cuentas, descontando las transferencias planificadas. La proyección supone que el acuerdo se cumple; la caja operativa muestra el dinero según los pagos y transferencias registrados.

«Aportes equivalentes del mes» propone cuánto aporta o recibe cada persona de la cuenta común, descontando los gastos que ya paga desde sus cuentas personales. Si no quedan gastos comunes, muestra la transferencia directa equivalente. La propuesta cambia con el reparto; las transferencias guardadas se editan por separado.

«Comisión por cambio» cobra una vez por cada transferencia positiva entre monedas distintas. No se cobra por mostrar una equivalencia en EUR ni por pagar con dinero que ya existe en la moneda del gasto. La comisión la asume el titular de la cuenta de origen o, si es común, su reparto configurado. El valor inicial es cero y se puede editar.

Los sliders fijan el porcentaje de cada gasto compartido. «Regla general» devuelve un registro al reparto global. «Igualar margen» puede compensar indirectamente los cambios de un slider mediante otros aportes.

Un grupo reúne gastos sin duplicarlos. Un gasto puede tener varias etiquetas; por eso las series de etiquetas pueden superponerse. «Marcar en gráfico» señala los meses de ese gasto y muestra su concepto e importe al seleccionarlos.

## Ejemplo ficticio

El [caso de prueba](ejemplos/caso_ficticio.json) contiene datos ficticios para comprobar ingresos por etapas, monedas, gastos recurrentes y cuotas superpuestas. Sus importes, fechas, saldos y tipos de cambio son supuestos de prueba. No se carga automáticamente al abrir la interfaz.

El [recorrido con resultados](docs/ejemplo_simulacion.md) explica el cálculo de ese caso. Se puede reproducir con:

```sh
python3 scripts/simular_ejemplo.py
python3 scripts/simular_ejemplo.py --json
```

Para regenerar el documento:

```sh
python3 scripts/simular_ejemplo.py --markdown > docs/ejemplo_simulacion.md
```

## Comprobar el proyecto

Las pruebas del modelo, la migración y el servidor usan Python. Las del editor y su integración con la API usan Node, sin dependencias adicionales.

```sh
python3 -m unittest discover -s pruebas
node --test pruebas/interfaz.test.cjs
node --test pruebas/browser-runtime.test.cjs
node --test pruebas/aportes.test.cjs
```

## Preparar la versión web

```sh
python3 scripts/preparar_pages.py
```

El comando genera `dist/` con una lista explícita de archivos públicos. No incluye archivos de `datos/`, `resultados/`, `outputs/` ni credenciales. GitHub Pages publica el contenido de la rama `gh-pages`; el código fuente está en `main`.
