// get id's

let productPage= document.getElementById("product_page");
let addProduct=document.getElementById("add_product");
let orderPage=document.getElementById("order_page");
let updatePage=document.getElementById("update_page");
let logOutPage=document.getElementById("logout_page");

let main=document.querySelector("main");

//All Api here
let productApi="https://63cae32cf36cbbdfc76280f7.mockapi.io/data";
const userApi="";


// adEventLIstner here;

//Product code here
productPage.addEventListener("click",()=>{
loadApi();
})
async function loadApi(){
try {
    let response=await fetch(productApi);
    response=await response.json();
    console.log(response);
createCard(response);
} catch (error) {
    console.log(error);
}
}

// product function 
function createCard(data){
    main.innerHTML="";
    let card=`
    <div class="productDiv">
    ${data.map((item)=> getCard(item.id,item.image,item.title,item.price,item.description)).join("")}
    </div>
    `
    main.innerHTML=card;

    let removeBtn=document.querySelectorAll(".removeBtn");

for (let i=0;i<removeBtn.length;i++){
    removeBtn[i].addEventListener("click",()=>{
        removeItem(removeBtn[i].id)
    })
}
}
//deleting item here

async function removeItem(id){
try {
let deletingItem=await fetch(`${productApi}/${id}`,{
    method:"DELETE",
    headers:{
        'Content-Type':'application/json'
    } 
})
// console.log(deletingItem)
if(deletingItem.ok){
    alert("Item Deleted")
   
}else{
    alert("Some Issue While Deleting the item")

}
} catch (error) {
    console.log(error);
}

    
}



function getCard(id,image,title,price,description){
    let card=`
    <div id=${id}>
    <div>
    <img src=${image} alt="Product image">
    </div>
    <div>
    <p>${title}</p>
    <p>${price}</p>
    <p>${description}</p>
    <button id=${id} class="removeBtn">Remove Item</button>
    </div>
    </div>
    `
    return card;
}



//customer page herer
addProduct.addEventListener("click",()=>{
    getForm();
})

function getForm(){
    main.innerHTML="";
    let add_product= `<form>
    <input type="text" placeholder="title" id="AddProductTitle">
    <input type="src" placeholder="image" id="AddProductImage">
    <input type="number" placeholder="price" id="AddProductPrice">
    <input type="" placeholder="description" id="AddProductDescription">
    <input type="submit" value="submit">
</form>`
main.innerHTML=add_product;

let add_product_image= document.getElementById("AddProductImage");
let add_product_title= document.getElementsByName("AddProductTitle");
let add_product_price= document.getElementById("AddProductPrice");
let add_product_description= document.getElementById("AddProductDescription");

let form= document.querySelector("form");

async function postData(){


    try {
        let obj={
        title:add_product_title.value,
        image:add_product_image.value,
        price:add_product_price.value,
        description:add_product_description.value
    } 

let postDetails=await fetch(`${productApi}`,{
    method:"POST",
    headers:{
        'Content-Type':'application/json'
    },
    body:JSON.stringify(obj)
})
if(postDetails.ok){
    alert("Item Added")
    
}else{
    alert("Some Issue")
}
    } catch (error) {
        console.log(error);
    }
    
}


form.addEventListener("submit",(e)=>{
e.preventDefault();
postData();


})
    
}




//update page here
updatePage.addEventListener("click",()=>{

forUpdateApi()

})

async function forUpdateApi(){
    try {
        let response=await fetch(productApi);
        response=await response.json();
        console.log(response);
        Update(response)
    } catch (error) {
        console.log(error);
    }

}

function Update(data){
    main.innerHTML="";
    let card=`
    <div class="productDiv">
    ${data.map((item)=> updateGetCard(item.id,item.image,item.title,item.price,item.description)).join("")}
    </div>
    `
    main.innerHTML=card;

    let updateBtn=document.querySelectorAll(".updateBtn");

for (let i=0;i<updateBtn.length;i++){
    updateBtn[i].addEventListener("click",()=>{
        updateItem(updateBtn[i].id)
    })
}
}


// update product

async function updateItem(id){
    try {
    let updatingItem=await fetch(`${productApi}/${id}`)
    updatingItem=await updatingItem.json();
   puttingData(updatingItem.id,updatingItem.price,updatingItem.title,updatingItem.image,updatingItem.description);
  
  
    } catch (error) {
        console.log(error);
    }
    
        
    }
function puttingData(id,price,title,image,description){
    main.innerHTML="";
    let add_product= `<form>
    <p id="productId">${id}</p>
    <input type="text" placeholder="title" value='${title}' id="AddProductTitle">
    <input type="src" placeholder="image" value='${image}' id="AddProductImage">
    <input type="number" placeholder="price" value= '${price}' id="AddProductPrice">
    <input type="" placeholder="description" value='${description}' id="AddProductDescription">
    <input type="submit" value="submit">
</form>`
main.innerHTML=add_product;

let form= document.querySelector("form")
let productId=document.getElementById("productId").innerText;
let updateImage= document.getElementById("AddProductImage");
let updateTitle= document.getElementById("AddProductTitle");
let updatePrice= document.getElementById("AddProductPrice");
let updateDescription= document.getElementById("AddProductDescription");





async function fetchingDataToApi(){
try {
    let obj={
        title:updateTitle.value,
        price:updatePrice.value,
        image:updateImage.value,
        description:updateDescription.value 
    }

    let res=await fetch(`${productApi}/${productId}`,{
        method:"PUT",
        headers:{
            'Content-Type':'application/json'
        },body:JSON.stringify(obj)
    })
    if(res.ok){
        console.log("Data updated")
    }else{
        console.log("Not")
    }
    
} catch (error) {
    console.log(error);
}
}

function puttingFinalData(){

}



form.addEventListener("submit",(e)=>{
    e.preventDefault();
fetchingDataToApi();
})
}


    
function updateGetCard(id,image,title,price,description){
    let card=`
    <div id=${id}>
    <img src=${image} alt="Product image">
    <p>${title}</p>
    <p>${price}</p>
    <p>${description}</p>
    <button id=${id} class="updateBtn">Edit Item</button>
    </div>
    `
    return card;

    
}



//order page here
orderPage.addEventListener("click",()=>{
    main.innerHTML="Hello order"
})

//logout page here
logOutPage.addEventListener("click",()=>{
    main.innerHTML="Hello logout"
})