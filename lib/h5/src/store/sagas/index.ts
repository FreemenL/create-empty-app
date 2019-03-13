
import { delay } from 'redux-saga';
import { all, call ,put, takeEvery ,fork,takeLatest ,apply,select,take ,cancel ,race} from "redux-saga/effects";
import * as types from '../action-types';
import { push } from 'connected-react-router'
import service from "@service/load-service";

interface Login{
	type:string,
	username:string,
	password:string|number
}

function* login(){
	/*takeLatest*/
	yield takeLatest(types.LOGIN_REQUEST,function*({type,username,password}:Login){
		try{
			const state = yield select();		
			let {response,timeout} = yield race({
				response: call(service.home.login,username,password),
				timeout: call(delay, 12000)
			});		
			yield put({type:types.LOGIN_SUCCESS,token:response });
			yield put(push('/logout'));
			return response;
		 }catch(error){
			put({type:types.LOGIN_ERROR,error});
		 }	
	});
	/* take */
	// let username,password;
	// while (true) {
	// 	const { username,password} = yield take(types.LOGIN_REQUEST)
	// 	let token = yield apply(service.home,service.home.login,[username,password]);
	// 	console.log(token);
	// }
}
function* watchIncrementAsync() {
	let token = yield call(service.home.login,"username","password");
}

export function* rootSaga({dispatch,getState}){
	yield all([
		login(),
		watchIncrementAsync()
	])
}
