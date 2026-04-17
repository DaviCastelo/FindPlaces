# App de Contatos de Empresas Locais

Aplicacao simples em Next.js para buscar empresas por localizacao no Brasil (bairro, cidade ou estado), filtrando por categoria e exibindo telefone, WhatsApp, e-mail (quando disponivel) e website.

## Funcionalidades

- Busca por localizacao + categoria (academia, padaria, lanchonete etc.)
- Sidebar colapsavel com navegacao entre Busca e Configuracoes
- Configuracao global de categorias habilitadas para o filtro
- Integracao gratuita com Nominatim + Overpass + Photon/Pelias
- Exibicao de contato comercial: telefone, WhatsApp, e-mail e website
- Paginacao de resultados com `next_page_token`
- Endpoint opcional para scraping de website e tentativa de extrair e-mail/telefone
- Enriquecimento automatico opcional de telefone (desligado por padrao para melhor performance)
- Limite simples por IP para proteger custo e abuso
- Cache em memoria para geocodificacao, busca e scraping

## Tecnologias

- Next.js (App Router) + TypeScript
- API Routes do Next.js
- Deploy recomendado na Vercel

## Configuracao local

1. Instale dependencias:

```bash
npm install
```

2. Copie o arquivo de ambiente:

```bash
cp .env.example .env.local
```

3. Rode em desenvolvimento:

```bash
npm run dev
```

## Variaveis de ambiente

- `ENABLE_SCRAPING`: `true` ou `false` para habilitar endpoint de scraping
- `ENABLE_AUTO_PHONE_ENRICHMENT`: `true` ou `false` para tentar descobrir telefone via busca + site oficial
- `ENRICH_TOP_N`: quantidade maxima de itens enriquecidos automaticamente na primeira pagina
- `ENRICH_CONCURRENCY`: concorrencia maxima de enriquecimento automatico
- `SCRAPE_TIMEOUT_MS`: timeout de scraping em ms (ex.: `3000`)
- `RATE_LIMIT_PER_MIN`: limite simples por IP/minuto
- `DEFAULT_SEARCH_RADIUS_M`: raio padrao da busca quando nao houver bbox (em metros)
- `SEARCH_PAGE_SIZE`: quantidade de empresas por pagina retornada pela busca
- `SEARCH_CACHE_TTL_MS`: TTL do cache da busca/geocodificacao (ms)
- `SCRAPER_CACHE_TTL_MS`: TTL do cache de descoberta/scraping (ms)
- `DEBUG_RUNTIME_LOGS`: habilita logs detalhados de depuracao (`true`/`false`)
- `OVERPASS_QUERY_TIMEOUT_S`: timeout da consulta Overpass em segundos
- `ENABLE_GRID_SEARCH`: habilita busca por sub-regioes da area (`true`/`false`)
- `SEARCH_GRID_MAX_CELLS`: quantidade maxima de celulas no grid de busca
- `SEARCH_MAX_AREAS`: limite de subconsultas Overpass por busca
- `FALLBACK_QUERY_LIMIT`: limite maximo de itens por consulta no fallback Nominatim
- `FALLBACK_MAX_QUERIES`: quantidade maxima de termos/sinonimos no fallback por categoria
- `SCRAPE_MAX_PAGES`: quantidade de paginas por site para varrer contatos

## Deploy na Vercel

1. Suba este projeto para um repositorio Git.
2. Importe o repositorio na [Vercel](https://vercel.com/).
3. Configure as variaveis de ambiente no projeto da Vercel.
4. Faça o deploy.

## Configuracao global de categorias

- Endpoint `GET /api/settings/categories`: retorna todas as categorias disponiveis + status habilitado/desabilitado.
- Endpoint `PUT /api/settings/categories`: salva a configuracao global (minimo de 1 categoria habilitada).
- A tela de Configuracoes permite alterar as categorias e persistir no backend.
- O filtro da tela de busca exibe apenas categorias habilitadas.

## Observacoes importantes

- A disponibilidade de telefone/e-mail depende dos dados publicos no OpenStreetMap.
- Geocodificacao usa Nominatim com fallback para Photon/Pelias.
- A busca de estabelecimentos usa Overpass API.
- O enriquecimento automatico tenta primeiro dados do OSM; se faltar telefone, tenta achar website publico e extrair telefone do HTML.
- Para resposta mais rapida, o enriquecimento automatico fica desativado por padrao e pode ser acionado sob demanda na interface.
- Google Maps fica apenas como link de consulta manual (sem scraping automatizado).
- Use os dados com responsabilidade e em conformidade com LGPD e regras de contato comercial.
# FindPlaces
