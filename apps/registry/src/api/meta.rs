use axum::routing::get;
use axum::{Json, Router};

use crate::config::PROTOCOL_VERSION;
use crate::models::MetaResponse;
use crate::AppState;

use super::ApiResult;

pub fn router() -> Router<AppState> {
    Router::new().route("/v1/meta", get(meta))
}

async fn meta(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> ApiResult<Json<MetaResponse>> {
    Ok(Json(MetaResponse {
        protocol_version: PROTOCOL_VERSION,
        name: state.config.instance_name.clone(),
    }))
}
