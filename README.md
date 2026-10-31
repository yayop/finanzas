# Finanzas en pareja

Simulador mensual de ingresos, gastos y reglas de reparto para dos personas. Los gastos pueden incluir pagos de deudas y cuotas. Permite comparar cuánto dinero queda disponible para cada integrante y para el hogar.

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

Las pestañas siguen el orden Registros, Reparto, Proyección y Operativa. Registros sirve para declarar ingresos y gastos: concepto, importe, moneda, fechas, frecuencia y cuotas. Las decisiones sobre quién asume cada gasto, qué parte se socializa, sus porcentajes y descuentos se toman en Reparto, junto con la regla general y la comparación de tasas equivalentes. Proyección muestra gráficos y resultados generales. Operativa queda al final para organizar cuentas y transferencias. El selector de mes de Reparto se comparte entre sus resultados y ajustes.

- Nombres editables para ambas personas.
- Ingresos y gastos con conceptos libres en EUR o CLP; las deudas se registran como gastos en cuotas.
- Pagos únicos, recurrencias cada uno a doce meses y planes de cuotas.
- Fechas de inicio y término, cuotas totales y cuotas ya pagadas.
- Responsabilidad personal o socializada, configurada en Reparto e independiente de quién realiza el pago.
- Socialización de gastos según una regla general o porcentajes propios por movimiento.
- Reparto 50/50, proporcional a ingresos, proporcional tras compromisos, igualdad de margen o porcentaje manual.
- Opción por gasto para descontar su parte asignada del ingreso antes del reparto «Tras compromisos».
- Inclusión opcional de ingresos extra en el cálculo del reparto.
- Proyecciones de hasta 60 meses, gráficos, saldos y compensaciones entre ambas personas.
- Compromisos posteriores al período proyectado.
- Pestaña Operativa con cuentas individuales o comunes, moneda, saldos y transferencias planificadas.
- Comisión fija en EUR por cada transferencia entre monedas, cargada en la cuenta de origen.
- Asignación de cada ingreso o pago a una cuenta y calendario de caja con saldos mínimos.
- Pestaña Reparto con todos los gastos, incluso los aún personales, para elegir su socialización y ajustar porcentajes.
- Comparación de equivalencia dentro de Reparto: tasa sobre gastos comunes y su equivalente sobre todos los gastos, conservando el excedente de cada persona.
- Grupos, etiquetas y marcas de gastos en el gráfico, con series mensuales o acumuladas.
- Referencia para comparar cambios, exportación e importación de planes JSON.

Los nombres iniciales son Yayo y Fer y pueden cambiarse en «Nombres». Por ejemplo, un gasto socializado de 100 EUR con un reparto 25/75 asigna 25 EUR a la primera persona y 75 EUR a la segunda, aunque cualquiera de las dos realice el pago. Bajo «Igualar margen», la compensación general puede redistribuir indirectamente el efecto de ese reparto.

En cualquier gasto se puede elegir «En cuotas». La fecha corresponde a la próxima cuota pendiente. Se puede introducir el total original a dividir entre todas las cuotas o el importe fijo de cada cuota. Las cuotas ya pagadas no vuelven a cobrarse. No se infieren capital pendiente ni intereses a partir de una cuota.

«Descontar antes de repartir» permite reconocer un gasto como compromiso previo en la regla «Tras compromisos». Marcado, reduce el ingreso considerado de quien asume su parte; desmarcado, sigue siendo un gasto de esa persona, pero no reduce la base del reparto. No cambia quién paga ni la cuenta. Los gastos nuevos se declaran personales y con el descuento desmarcado; su socialización se configura después en Reparto. Los planes anteriores conservan sus descuentos al importarse o recuperarse y los registros antes llamados «Deuda» pasan a «Gasto» con sus cuotas intactas.

## Datos y almacenamiento

Los cambios válidos y la referencia se guardan en el almacenamiento local del navegador. Abrir o vaciar la pantalla no sobrescribe la copia anterior. Los planes no se sincronizan automáticamente entre computadores; se pueden transferir mediante «Exportar» e «Importar», conservando también su referencia de comparación.

El servidor local escucha únicamente en el propio equipo y no guarda los datos recibidos en archivos. Los archivos personales pueden conservarse en `datos/`, excluido de Git. También se excluyen resultados locales, credenciales y artefactos de `outputs/`.

Los planes de la versión anterior se convierten al formato de movimientos conservando importes, fechas y repartos. Los gastos antes compartidos al 100 % se muestran como «Socializado»; los personales parcialmente socializados conservan su porcentaje. La copia anterior del navegador se mantiene.

## Alcance del cálculo

Los resultados son mensuales y previos a reservar ahorro. Los movimientos conservan su moneda original y se presentan en EUR, usando un tipo de cambio constante editable. Las conversiones planificadas entre cuentas pueden incluir la comisión configurada. Los saldos sin cuenta se introducen en EUR y los de cada cuenta en su moneda.

La pestaña Operativa calcula la caja por cuenta en las fechas registradas. Si coinciden pagos e ingresos en una fecha, considera primero las salidas para mostrar un mínimo conservador; no conoce las horas bancarias. Las transferencias son planificación y no se ejecutan. El modelo no conecta con bancos ni calcula derechos o importes legales de prestaciones. Un saldo negativo indica dinero por cubrir; no genera un crédito automático.

## Cuentas y perspectivas

Los saldos iniciales de las cuentas se suman al «Saldo sin cuenta» de cada persona. No se debe registrar el mismo dinero en ambos lugares. Las cuentas conjuntas atribuyen su saldo según el porcentaje configurado. Cada movimiento conserva quién asume su costo, quién paga y desde qué cuenta sale o entra el dinero.

«Por reparto» muestra el costo asumido; «Por pagos» muestra los pagos atribuidos a cada persona; en las cuentas conjuntas se usa su porcentaje. Los pagos de uno reducen su aporte pendiente en los demás. La compensación pendiente es acumulada y compara el acuerdo con la posición real por cuentas, descontando las transferencias planificadas. La proyección supone que el acuerdo se cumple; la caja operativa muestra el dinero según los pagos y transferencias registrados.

«Aportes equivalentes del mes» propone cuánto aporta o recibe cada persona de la cuenta común, descontando los gastos que ya paga desde sus cuentas personales. Si no quedan gastos comunes, muestra la transferencia directa equivalente. La propuesta cambia con el reparto; las transferencias guardadas se editan por separado.

«Comisión por cambio» cobra una vez por cada transferencia positiva entre monedas distintas. No se cobra por mostrar una equivalencia en EUR ni por pagar con dinero que ya existe en la moneda del gasto. La comisión la asume el titular de la cuenta de origen o, si es común, su reparto configurado. El valor inicial es cero y se puede editar.

En Reparto, cada gasto permite elegir responsabilidad personal o socializada, reparto con regla general o porcentaje fijo, parte socializada y descuento previo. Los sliders fijan los porcentajes sin cambiar el importe, las fechas ni quién paga. «Regla general» devuelve un registro al reparto global. «Igualar margen» puede compensar indirectamente los cambios de un slider mediante otros aportes.

Dentro de Reparto, «Tras compromisos» reparte los gastos comunes según el ingreso considerado menos los gastos marcados para descontar. Si `Dk` es la parte marcada que ya se asignó a cada persona, la tasa es `αk = (Ik − Dk) / (I1 + I2 − D1 − D2)`. Un gasto personal parcialmente socializado solo descuenta su parte previamente asignada; un gasto con reparto fijo puede descontar la parte de cada persona. Los socializados con «Regla general» forman el gasto común y no se descuentan también de la base. Las comisiones de cambio se mantienen como compromisos previos de quien las asume. Por ejemplo, para que alguien asuma un compromiso y aporte proporcionalmente menos al arriendo, hay que marcar ese compromiso y usar «Regla general» en el arriendo.

«Por compromisos» muestra la tasa sobre gastos comunes; «Tasa única» muestra el porcentaje equivalente sobre el gasto total: `α′k = (Gk + αk × Gc) / (Gc + G1 + G2)`. Aquí `Gk` incluye todos los gastos previamente asignados, marcados o no: siempre reducen el excedente. Cambiar esta presentación conserva costos, excedentes, pagadores y transferencias. La regla base sí cambia el acuerdo. Las tasas se calculan por mes a partir de los costos exactos en céntimos; los porcentajes mostrados están redondeados y no se usan para recalcular dinero. El excedente incluye los ingresos reales, aunque se excluyan ingresos extra de la base del reparto, y no incluye ahorro ni revalorizaciones del saldo por cambio de divisa.

Sin gastos, la tasa única queda sin definir. Si «Igualar margen» redistribuye ingresos con gasto total cero, no existe una tasa equivalente sobre ese total. Una tasa fuera de 0–100 % indica que el acuerdo incluye recibir dinero, además de pagar gastos.

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
node --test pruebas/equivalencia_ui.test.cjs
```

## Preparar la versión web

```sh
python3 scripts/preparar_pages.py
```

El comando genera `dist/` con una lista explícita de archivos públicos. No incluye archivos de `datos/`, `resultados/`, `outputs/` ni credenciales. GitHub Pages publica el contenido de la rama `gh-pages`; el código fuente está en `main`.
